import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";

import { executeGit, gitExecutionControl } from "./git-execution.js";
import { ProcessExecutionError } from "./process-execution.js";
import { requireWriteScope } from "./inputs.js";
import type { DurableTaskHost } from "./task-host.js";
import { TaskMetadataDoc } from "./task-state.js";
import {
  acquireClaim,
  acquireAdmissionGate,
  readReservation,
  unreleasedReservations,
  writeRecord,
  type ClaimLock,
  type Reservation,
} from "./workspace-claims.js";
import {
  canonicalTarget,
  inspectGit,
  requireSameGit,
  requireSameGitIdentity,
  type GitBinding,
} from "./workspace-git.js";
import { inspectRelease, confirmInspection, type ConfirmInspection } from "./workspace-release.js";
import {
  verifyContextHashes,
  WorkspacesDoc,
  type AssignmentApproval,
  type AssignmentRecord,
} from "./workspace-state.js";

function compareWorktrees(
  first: Pick<AssignmentApproval, "worktree">,
  second: Pick<AssignmentApproval, "worktree">,
) {
  if (first.worktree === second.worktree) return 0;

  return first.worktree < second.worktree ? -1 : 1;
}

function within(parent: string, child: string) {
  const path = relative(parent, child);

  return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

// Reservations survive removed targets. Canonicalize the surviving prefix so a
// recreated parent with different filesystem casing cannot evade nested claims.
async function canonicalReservationPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const parent = dirname(path);

    if (parent === path) throw error;

    return join(await canonicalReservationPath(parent), basename(path));
  }
}

function requireAuthority(authority: string) {
  if (!authority.trim()) throw new Error("Explicit operator approval is required");
}

function requireOwnedAssignment(
  host: DurableTaskHost,
  record: AssignmentRecord,
  repository: GitBinding,
) {
  if (
    record.reservation.taskId !== host.taskId ||
    record.reservation.taskDirectory !== host.directory ||
    record.reservation.assignmentId !== record.id ||
    record.reservation.worktree !== record.worktree ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.id) ||
    !/^[0-9a-f]{40,64}$/.test(record.base) ||
    (record.binding &&
      (record.binding.worktree !== record.worktree ||
        record.binding.branch !== record.branch ||
        record.binding.commonDirectory !== repository.commonDirectory))
  ) {
    throw new Error("Assignment identity differs from its task/repository binding");
  }

  requireWriteScope(record.writePaths);
}

function requireClaimReference(record: AssignmentRecord, claim: ClaimLock) {
  if (
    record.claimDirectory !== claim.directory ||
    record.reservation.lockDevice !== claim.device ||
    record.reservation.lockInode !== claim.inode
  )
    throw new Error("Assignment claim identity changed");
}

function requireReservation(record: AssignmentRecord, claim: ClaimLock) {
  requireClaimReference(record, claim);
  const reservation = readReservation(claim, record.worktree);

  if (
    !reservation ||
    JSON.stringify(reservation) !== JSON.stringify(record.reservation) ||
    reservation.releaseId !== null ||
    claim.directory !== record.claimDirectory
  ) {
    throw new Error(
      "Missing/inconsistent assignment reservation; explicit reconciliation is required",
    );
  }
}

export class WritableWorkspaces {
  private readonly claims = new Map<string, ClaimLock>();
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private blocker: string | undefined;
  private unresolvedActivity = false;
  private callerSourceDrift = false;

  private retainUnresolved(error: Error) {
    if (!(error instanceof ProcessExecutionError) || error.outcome.quiescent) return false;
    this.unresolvedActivity = true;
    this.blocker = error.message;

    return true;
  }

  constructor(private readonly host: DurableTaskHost) {}

  get blockedReason() {
    return this.blocker;
  }

  private exclusive<T>(operation: () => Promise<T>) {
    if (this.stopped) return Promise.reject(new Error("Task workspace owner is closing"));

    const result = this.pending.then(async () => {
      if (this.unresolvedActivity) throw new Error(this.blocker);

      try {
        return await operation();
      } catch (error) {
        if (error instanceof Error) this.retainUnresolved(error);
        throw error;
      }
    });

    this.pending = result.then(
      () => {},
      () => {},
    );

    return result;
  }

  async drain() {
    this.stopped = true;
    await this.pending;

    if (this.unresolvedActivity) throw new Error(this.blocker);
  }

  releaseKernelClaims() {
    if (this.unresolvedActivity) throw new Error(this.blocker);

    for (const claim of this.claims.values()) claim.release();
    this.claims.clear();
  }

  async inspect(context: Context) {
    return {
      state: await this.host.harness.snapshot(WorkspacesDoc, context),
      blockedReason: this.blocker,
    };
  }

  async reopen(context: Context) {
    this.callerSourceDrift = false;
    const control = gitExecutionControl(context.abortSignal);
    const state = await this.host.harness.snapshot(WorkspacesDoc, context);

    if (
      !state ||
      (state.repository === null && state.assignments.length === 0 && state.effects.length === 0)
    )
      return;

    try {
      if (!state.repository) throw new Error("Workspace repository binding is missing");
      const metadata = await this.host.harness.snapshot(TaskMetadataDoc, context);

      if (state.repository.worktree !== metadata?.record?.repositoryRoot)
        throw new Error("Workspace repository differs from the owning task");
      const actualRepository = await inspectGit(state.repository.worktree, control);
      requireSameGitIdentity(state.repository, actualRepository);
      const callerSourceDrift = state.repository.sourceHash !== actualRepository.sourceHash;

      const active = state.assignments
        .filter((record) => record.status !== "released")
        .sort(compareWorktrees);

      if (active.length > 2) throw new Error("Too many active writable assignments");
      const acquired: ClaimLock[] = [];

      try {
        for (const record of active) {
          requireOwnedAssignment(this.host, record, state.repository);
          context.abortSignal?.throwIfAborted();

          const claim = await acquireClaim(
            state.repository.commonDirectory,
            record.worktree,
            false,
          );

          acquired.push(claim);
          requireReservation(record, claim);
          await verifyContextHashes(record.contextHashes, control);

          if (record.status !== "admitted" || !record.binding)
            throw new Error("Unresolved workspace admission intent");
          await requireSameGit(record.binding, undefined, control);
        }

        if (state.effects.some((effect) => effect.status !== "observed"))
          throw new Error("Unresolved workspace effect intent");

        if (callerSourceDrift) {
          // A release-only reopen is not edit readiness. Reservations remain
          // durable; an explicit release reacquires and validates its own claim.
          for (const claim of acquired) claim.release();
        } else {
          for (let index = 0; index < active.length; index++) {
            const record = active[index];
            const claim = acquired[index];

            if (record && claim) this.claims.set(record.id, claim);
          }
        }

        this.callerSourceDrift = callerSourceDrift;

        if (callerSourceDrift)
          this.blocker =
            "Caller material source binding changed; only explicit release of unchanged assignments is allowed";
      } catch (error) {
        if (error instanceof Error && this.retainUnresolved(error)) {
          for (let index = 0; index < acquired.length; index++) {
            const record = active[index];
            const claim = acquired[index];

            if (record && claim) this.claims.set(record.id, claim);
          }
        } else {
          for (const claim of acquired) claim.release();
        }

        throw error;
      }
    } catch (error) {
      if (error instanceof Error) this.retainUnresolved(error);
      this.blocker = error instanceof Error ? error.message : "Workspace admission is blocked";
    }
  }

  admit(
    repositoryInput: GitBinding,
    approvalInputs: readonly AssignmentApproval[],
    authority: string,
    context: Context,
  ) {
    const control = gitExecutionControl(context.abortSignal);

    const git = (directory: string, argv: readonly string[]) =>
      executeGit({ cwd: directory, argv, ...control });

    const repository = { ...repositoryInput };

    const approvals = approvalInputs.map((input): AssignmentApproval => {
      const fields = {
        id: input.id,
        worktree: input.worktree,
        branch: input.branch,
        base: input.base,
        writePaths: [...input.writePaths],
        contextHashes: input.contextHashes.map((source) => ({ ...source })),
      };

      if (input.kind === "existing")
        return { ...fields, kind: "existing", binding: { ...input.binding } };

      return { ...fields, kind: "create" };
    });

    return this.exclusive(async () => {
      context.abortSignal?.throwIfAborted();
      requireAuthority(authority);

      if (this.blocker) throw new Error(this.blocker);
      const state = await this.host.harness.snapshot(WorkspacesDoc, context);
      const metadata = await this.host.harness.snapshot(TaskMetadataDoc, context);
      const active = state?.assignments.filter((record) => record.status !== "released") ?? [];

      if (
        !approvals.length ||
        active.length + approvals.length > 2 ||
        state?.effects.some((effect) => effect.status !== "observed")
      ) {
        throw new Error("Admission requires one or two writers and no unresolved effects");
      }

      if (metadata?.record?.repositoryRoot !== repository.worktree)
        throw new Error("Task cannot admit a second repository");
      await requireSameGit(repository, undefined, control);

      if (state?.repository) await requireSameGit(state.repository, repository, control);

      for (const record of active) requireOwnedAssignment(this.host, record, repository);
      const paths = active.map((record) => record.worktree);
      const branches = new Set(active.map((record) => record.branch));
      const ids = new Set(state?.assignments.map((record) => record.id));
      const gate = await acquireAdmissionGate(repository.commonDirectory);

      try {
        await requireSameGit(repository, undefined, control);
        const ordered = [...approvals].sort(compareWorktrees);

        const registered = (
          await git(repository.worktree, ["worktree", "list", "--porcelain", "-z"])
        )
          .split("\0")
          .filter((entry) => entry.startsWith("worktree "))
          .map((entry) => entry.slice(9));

        const reserved = unreleasedReservations(repository.commonDirectory).map(
          (entry) => entry.worktree,
        );

        const globalPaths = new Set([...registered, ...reserved]);

        for (const path of registered.concat(reserved))
          globalPaths.add(await canonicalReservationPath(path));

        for (const approval of ordered) {
          await canonicalTarget(approval.worktree);

          for (const path of globalPaths) {
            // Exact-path claim/reservation checks below retain their existing
            // release/ownership rules. Ancestors and descendants can never share.
            if (
              path !== approval.worktree &&
              (within(path, approval.worktree) || within(approval.worktree, path))
            )
              throw new Error(
                "Assignment overlaps a repository-wide worktree or unreleased reservation",
              );
          }

          if (
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(approval.id) ||
            ids.has(approval.id) ||
            branches.has(approval.branch) ||
            within(repository.worktree, approval.worktree) ||
            within(approval.worktree, repository.worktree) ||
            paths.some((path) => within(path, approval.worktree) || within(approval.worktree, path))
          ) {
            throw new Error(
              "Assignments require unique IDs, distinct branches, and exclusive worktrees outside the caller checkout",
            );
          }

          await git(repository.worktree, ["check-ref-format", "--branch", approval.branch]);

          if (!/^[0-9a-f]{40,64}$/.test(approval.base))
            throw new Error("Assignment base must be a pinned commit");
          await git(repository.worktree, ["rev-parse", "--verify", `${approval.base}^{commit}`]);
          requireWriteScope(approval.writePaths);
          await verifyContextHashes(approval.contextHashes, control);

          if (approval.kind === "create") {
            if (
              lstatSync(approval.worktree, { throwIfNoEntry: false }) ||
              (await git(repository.worktree, ["branch", "--list", approval.branch])).trim()
            ) {
              throw new Error("Worktree creation never replaces an existing directory or branch");
            }
          } else {
            await requireSameGit(approval.binding, undefined, control);

            if (
              approval.binding.worktree !== approval.worktree ||
              approval.binding.commonDirectory !== repository.commonDirectory ||
              approval.binding.branch !== approval.branch
            ) {
              throw new Error("Existing worktree does not match the approved repository/branch");
            }

            await git(approval.worktree, ["merge-base", "--is-ancestor", approval.base, "HEAD"]);
          }

          paths.push(approval.worktree);
          branches.add(approval.branch);
          ids.add(approval.id);
        }

        const acquired = new Map<string, ClaimLock>();
        const records: AssignmentRecord[] = [];
        const effectId = randomUUID();
        let retained = false;

        try {
          for (const approval of ordered) {
            const claim = await acquireClaim(repository.commonDirectory, approval.worktree, true);
            acquired.set(approval.id, claim);
            const previous = readReservation(claim, approval.worktree);

            if (previous && previous.releaseId === null)
              throw new Error(
                "Worktree has an unresolved assignment reservation; owner death does not release it",
              );

            const reservation: Reservation = {
              formatVersion: 1,
              taskId: this.host.taskId,
              assignmentId: approval.id,
              taskDirectory: this.host.directory,
              worktree: approval.worktree,
              lockDevice: claim.device,
              lockInode: claim.inode,
              releaseId: null,
            };

            records.push({
              id: approval.id,
              worktree: approval.worktree,
              branch: approval.branch,
              base: approval.base,
              writePaths: [...approval.writePaths],
              contextHashes: approval.contextHashes.map((source) => ({ ...source })),
              claimDirectory: claim.directory,
              reservation,
              status: "pending",
              binding: null,
            });
          }

          context.abortSignal?.throwIfAborted();
          await this.host.harness.commit(async (tx) => {
            const document = await tx.doc(WorkspacesDoc);
            document.repository ??= { ...repository };
            document.assignments.push(...records);
            document.effects.push({
              id: effectId,
              operation: "admit",
              assignmentIds: records.map((record) => record.id),
              status: "intent",
              authority,
              evidence: null,
            });
          }, context);

          for (const approval of ordered) {
            const record = records.find((entry) => entry.id === approval.id);

            if (!record) throw new Error("Assignment intent is missing");
            context.abortSignal?.throwIfAborted();
            await requireSameGit(repository, undefined, control);
            await canonicalTarget(approval.worktree);
            writeRecord(join(record.claimDirectory, "reservation.json"), record.reservation);

            if (approval.kind === "create")
              await git(repository.worktree, [
                "worktree",
                "add",
                "-b",
                approval.branch,
                approval.worktree,
                approval.base,
              ]);
            record.binding = await inspectGit(approval.worktree, control);

            if (approval.kind === "existing")
              await requireSameGit(approval.binding, record.binding, control);

            if (
              record.binding.commonDirectory !== repository.commonDirectory ||
              record.binding.branch !== approval.branch ||
              (approval.kind === "create" && record.binding.head !== approval.base)
            )
              throw new Error("Created worktree binding is inconsistent");
          }

          await requireSameGit(repository, undefined, control);
          await this.host.harness.commit(async (tx) => {
            const document = await tx.doc(WorkspacesDoc);

            for (const record of records) {
              const stored = document.assignments.find((entry) => entry.id === record.id);

              if (!stored) throw new Error("Assignment intent disappeared");
              stored.binding = record.binding;
              stored.status = "admitted";
            }

            const effect = document.effects.find((entry) => entry.id === effectId);

            if (!effect) throw new Error("Admission effect intent disappeared");
            effect.status = "observed";
            effect.evidence =
              "Reservations and actual Git worktrees observed after creation/admission";
          }, context);

          for (const [id, claim] of acquired) this.claims.set(id, claim);
          retained = true;
        } catch (error) {
          if (error instanceof Error && this.retainUnresolved(error)) {
            for (const [id, claim] of acquired) this.claims.set(id, claim);
            retained = true;
          }

          const latest = await this.host.harness.snapshot(
            WorkspacesDoc,
            withoutAbortSignal(context),
          );

          if (
            !this.unresolvedActivity &&
            latest?.effects.some((effect) => effect.status === "intent")
          )
            this.blocker = "Unresolved workspace effect; inspection/reconciliation required";
          throw error;
        } finally {
          if (!retained) for (const claim of acquired.values()) claim.release();
        }
      } finally {
        gate.release();
      }
    });
  }

  reconcile(confirm: ConfirmInspection, context: Context) {
    const control = gitExecutionControl(context.abortSignal);

    const git = (directory: string, argv: readonly string[]) =>
      executeGit({ cwd: directory, argv, ...control });

    return this.exclusive(async () => {
      const state = await this.host.harness.snapshot(WorkspacesDoc, context);

      if (!state?.repository) throw new Error("No workspace admission to reconcile");

      if (state.assignments.filter((record) => record.status !== "released").length > 2)
        throw new Error("Too many active writable assignments");
      await requireSameGit(state.repository, undefined, control);
      const acquired = new Map<string, ClaimLock>();
      const bindings = new Map<string, GitBinding>();
      const evidence: string[] = [];

      try {
        for (const record of [...state.assignments]
          .filter((entry) => entry.status !== "released")
          .sort(compareWorktrees)) {
          requireOwnedAssignment(this.host, record, state.repository);

          const claim =
            this.claims.get(record.id) ??
            (await acquireClaim(state.repository.commonDirectory, record.worktree, false));

          if (!this.claims.has(record.id)) acquired.set(record.id, claim);
          requireClaimReference(record, claim);
          const reservation = readReservation(claim, record.worktree);

          if (reservation && JSON.stringify(reservation) !== JSON.stringify(record.reservation))
            throw new Error("Cannot reconcile another reservation");

          if (!reservation && record.status !== "pending")
            throw new Error("An admitted reservation disappeared");
          const binding = await inspectGit(record.worktree, control);

          if (
            binding.commonDirectory !== state.repository.commonDirectory ||
            binding.branch !== record.branch ||
            (record.binding &&
              (binding.device !== record.binding.device || binding.inode !== record.binding.inode))
          )
            throw new Error("Moved/replaced or unrelated worktree cannot be reconciled");
          await git(record.worktree, ["merge-base", "--is-ancestor", record.base, "HEAD"]);
          await verifyContextHashes(record.contextHashes, control);
          const inspection = await inspectRelease(binding, record.reservation, control);
          const proof = await confirmInspection(inspection, await confirm(inspection), control);
          evidence.push(JSON.stringify(proof));
          bindings.set(record.id, binding);
        }

        for (const binding of bindings.values()) await requireSameGit(binding, undefined, control);
        const effectId = randomUUID();
        await this.host.harness.commit(async (tx) => {
          const document = await tx.doc(WorkspacesDoc);
          document.effects.push({
            id: effectId,
            operation: "reconcile",
            assignmentIds: [...bindings.keys()],
            status: "intent",
            authority: "Explicit operator reconciliation",
            evidence: evidence.join("\n"),
          });
        }, context);

        for (const record of state.assignments.filter((entry) => bindings.has(entry.id)))
          writeRecord(join(record.claimDirectory, "reservation.json"), record.reservation);
        await this.host.harness.commit(async (tx) => {
          const document = await tx.doc(WorkspacesDoc);

          for (const record of document.assignments) {
            const binding = bindings.get(record.id);

            if (binding) {
              record.binding = binding;
              record.status = "admitted";
            }
          }

          for (const effect of document.effects)
            if (effect.status === "intent") {
              effect.status = "observed";
              effect.evidence = `Explicit operator inspection; not an invented SDK tool success: ${evidence.join("\n")}`;
            }
        }, context);

        for (const [id, claim] of acquired) this.claims.set(id, claim);
        acquired.clear();
        this.blocker = undefined;
        this.callerSourceDrift = false;
      } catch (error) {
        if (error instanceof Error && this.retainUnresolved(error)) {
          for (const [id, claim] of acquired) this.claims.set(id, claim);
          acquired.clear();
        }

        throw error;
      } finally {
        for (const claim of acquired.values()) claim.release();
      }
    });
  }

  release(id: string, confirm: ConfirmInspection, context: Context) {
    const control = gitExecutionControl(context.abortSignal);

    return this.exclusive(async () => {
      const state = await this.host.harness.snapshot(WorkspacesDoc, context);
      const record = state?.assignments.find((entry) => entry.id === id);

      if (
        !record ||
        !record.binding ||
        !state?.repository ||
        record.status === "pending" ||
        (this.blocker && !this.callerSourceDrift) ||
        state.effects.some((effect) => effect.status === "intent")
      )
        throw new Error("Only the owning resolved assignment can release its worktree");

      requireOwnedAssignment(this.host, record, state.repository);

      if (this.callerSourceDrift)
        requireSameGitIdentity(
          state.repository,
          await inspectGit(state.repository.worktree, control),
        );
      const borrowed = this.claims.get(id);

      if (!borrowed && record.status !== "released" && !this.callerSourceDrift)
        throw new Error("Assignment claim is not held");

      const claim =
        borrowed ?? (await acquireClaim(state.repository.commonDirectory, record.worktree, false));

      try {
        requireReservation(record, claim);
        await requireSameGit(record.binding, undefined, control);
        const inspection = await inspectRelease(record.binding, record.reservation, control);
        const proof = await confirmInspection(inspection, await confirm(inspection), control);

        if (this.callerSourceDrift)
          requireSameGitIdentity(
            state.repository,
            await inspectGit(state.repository.worktree, control),
          );
        context.abortSignal?.throwIfAborted();
        const releaseId = randomUUID();
        await this.host.harness.commit(async (tx) => {
          const document = await tx.doc(WorkspacesDoc);
          const current = document.assignments.find((entry) => entry.id === id);

          if (
            JSON.stringify(current) !== JSON.stringify(record) ||
            JSON.stringify(document.repository) !== JSON.stringify(state.repository) ||
            document.effects.some((entry) => entry.status === "intent")
          )
            throw new Error("Assignment or effects changed during release inspection");
          document.effects.push({
            id: releaseId,
            operation: "release",
            assignmentIds: [id],
            status: "intent",
            authority: proof.authority,
            evidence: JSON.stringify(proof),
          });
        }, context);
        writeRecord(join(claim.directory, `release-${releaseId}.json`), {
          formatVersion: 1,
          releaseId,
          reservation: record.reservation,
          proof,
          kind: "assignment",
          observedAt: Date.now(),
        });
        await this.host.harness.commit(async (tx) => {
          const document = await tx.doc(WorkspacesDoc);
          const assignment = document.assignments.find((entry) => entry.id === id);
          const effect = document.effects.find((entry) => entry.id === releaseId);

          if (!assignment || !effect) throw new Error("Release intent disappeared");
          assignment.status = "released";
          effect.status = "observed";
        }, context);
        // This public marker is last: a crash before the SDK receipt leaves the reservation blocking.
        writeRecord(join(claim.directory, "reservation.json"), {
          ...record.reservation,
          releaseId,
        });
        claim.release();
        this.claims.delete(id);
      } catch (error) {
        if (error instanceof Error && this.retainUnresolved(error)) this.claims.set(id, claim);
        throw error;
      } finally {
        if (!borrowed && !this.unresolvedActivity) claim.release();
      }
    });
  }
}
