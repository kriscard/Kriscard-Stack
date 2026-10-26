import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Context } from "@earendil-works/chord";

import { gitExecutionControl, type GitExecutionControl } from "./git-execution.js";
import { ProcessExecutionError, runProcess } from "./process-execution.js";
import { requireTaskId } from "./inputs.js";
import { checkSqliteFiles } from "./task-files.js";
import {
  acquireClaim,
  lockPrivateFile,
  privateDirectory,
  readReservation,
  writeRecord,
  type Reservation,
} from "./workspace-claims.js";
import { inspectGit, requireSameGit, type GitBinding } from "./workspace-git.js";

export type ReleaseInspection = {
  inspectionId: string;
  binding: GitBinding;
  reservation: Reservation;
  processTable: string;
  matchingProcesses: string[];
};

export type OperatorProof = {
  inspectionId: string;
  authority: string;
  activityEvidence: string;
  effectEvidence: string;
  quiescent: boolean;
};

// This callback belongs to trusted direct-operator controls, never to a model tool.
export type ConfirmInspection = (inspection: ReleaseInspection) => Promise<OperatorProof>;

// Path matching flags candidates; cwd/env-only writers still require the operator's inspection.
async function processes(worktree: string, control: GitExecutionControl) {
  const remaining = control.deadline - Date.now();

  if (remaining <= 0) throw new Error("Release inspection deadline expired");

  const outcome = await runProcess(
    "ps",
    ["-axo", "pid=,ppid=,pgid=,command="],
    worktree,
    process.env,
    Math.min(10_000, remaining),
    control.signal,
  );

  if (outcome.reason !== "exited" || outcome.exitCode !== 0 || !outcome.quiescent)
    throw new ProcessExecutionError(outcome, "Process inspection");
  const table = outcome.stdout;

  const matching = table
    .split("\n")
    .filter(
      (line) => Number(line.trim().split(/\s+/)[0]) !== process.pid && line.includes(worktree),
    );

  return { table, matching };
}

export async function inspectRelease(
  binding: GitBinding,
  reservation: Reservation,
  control: GitExecutionControl = gitExecutionControl(),
): Promise<ReleaseInspection> {
  await requireSameGit(binding, undefined, control);
  const observed = await processes(binding.worktree, control);

  return {
    inspectionId: createHash("sha256")
      .update(JSON.stringify([binding, reservation, observed.table]))
      .digest("hex"),
    binding,
    reservation,
    processTable: observed.table,
    matchingProcesses: observed.matching,
  };
}

export async function confirmInspection(
  inspection: ReleaseInspection,
  proof: OperatorProof,
  control: GitExecutionControl = gitExecutionControl(),
) {
  if (
    proof.inspectionId !== inspection.inspectionId ||
    !proof.authority.trim() ||
    !proof.activityEvidence.trim() ||
    !proof.effectEvidence.trim() ||
    proof.quiescent !== true ||
    inspection.matchingProcesses.length
  ) {
    throw new Error(
      "Release requires explicit operator authority, inspected effects/processes, and established quiescence",
    );
  }

  await requireSameGit(inspection.binding, undefined, control);

  if ((await processes(inspection.binding.worktree, control)).matching.length)
    throw new Error("Possible orphaned command activity still exists; release is blocked");

  return {
    ...proof,
    observedBinding: { ...inspection.binding },
    processTableHash: createHash("sha256").update(inspection.processTable).digest("hex"),
  };
}

function requireUnavailableStore(directory: string) {
  const database = join(directory, "session.sqlite");

  if (!lstatSync(directory, { throwIfNoEntry: false })) return;
  checkSqliteFiles(directory, false);

  if (!lstatSync(database, { throwIfNoEntry: false })) return;
  let storage: DatabaseSync | undefined;

  try {
    storage = new DatabaseSync(database, { readOnly: true });
    const result = storage.prepare("PRAGMA quick_check").get();

    if (result?.quick_check !== "ok") return;
  } catch {
    // The existing task lock is already held; no recovery opens or repairs this database.
    return;
  } finally {
    storage?.close();
  }

  throw new Error(
    "Original task store is readable; use its owning assignment's reconciliation/release controls",
  );
}

export async function releaseStrandedWorktree(
  worktree: string,
  confirm: ConfirmInspection,
  context: Context,
) {
  context.abortSignal?.throwIfAborted();
  const control = gitExecutionControl(context.abortSignal);
  const binding = await inspectGit(worktree, control);
  const claim = await acquireClaim(binding.commonDirectory, worktree, false);
  let taskLock: Awaited<ReturnType<typeof lockPrivateFile>> | undefined;
  let unresolvedActivity = false;

  try {
    const reservation = readReservation(claim, worktree);

    if (!reservation || reservation.releaseId !== null)
      throw new Error("There is no stranded reservation to release");
    requireTaskId(reservation.taskId);

    if (
      !isAbsolute(reservation.taskDirectory) ||
      basename(reservation.taskDirectory) !== reservation.taskId
    )
      throw new Error("Task-state location reference is invalid");
    privateDirectory(dirname(reservation.taskDirectory));

    if (lstatSync(reservation.taskDirectory, { throwIfNoEntry: false })) {
      privateDirectory(reservation.taskDirectory);
      taskLock = await lockPrivateFile(join(reservation.taskDirectory, "owner.lock"), false);
    }

    requireUnavailableStore(reservation.taskDirectory);
    const inspection = await inspectRelease(binding, reservation, control);
    const proof = await confirmInspection(inspection, await confirm(inspection), control);
    context.abortSignal?.throwIfAborted();
    requireUnavailableStore(reservation.taskDirectory);
    const releaseId = randomUUID();
    writeRecord(join(claim.directory, `release-${releaseId}.json`), {
      formatVersion: 1,
      releaseId,
      kind: "operator-unavailable-store",
      reservation,
      proof,
      observedAt: Date.now(),
      outcome: "Ownership released only; original task outcome remains uncertified",
    });
    writeRecord(join(claim.directory, "reservation.json"), { ...reservation, releaseId });

    return { releaseId, tombstone: join(claim.directory, `release-${releaseId}.json`) };
  } catch (error) {
    unresolvedActivity = error instanceof ProcessExecutionError && !error.outcome.quiescent;
    throw error;
  } finally {
    // An unresolved process leaves these kernel descriptors held until operator
    // reconciliation/process shutdown, never an automatic reservation release.
    if (!unresolvedActivity) {
      taskLock?.release();
      claim.release();
    }
  }
}
