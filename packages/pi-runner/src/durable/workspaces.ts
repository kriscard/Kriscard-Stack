import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";

import { requireWriteScope } from "./inputs.js";
import type { DurableTaskHost } from "./task-host.js";
import { TaskMetadataDoc } from "./task-state.js";
import {
  acquireClaim,
  acquireAdmissionGate,
  readReservation,
  writeRecord,
  type ClaimLock,
  type Reservation,
} from "./workspace-claims.js";
import {
  canonicalTarget,
  git,
  inspectGit,
  requireSameGit,
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

  constructor(private readonly host: DurableTaskHost) {}

  get blockedReason() {
    return this.blocker;
  }

  private exclusive<T>(operation: () => Promise<T>) {
    if (this.stopped) return Promise.reject(new Error("Task workspace owner is closing"));
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => {},
      () => {},
    );

    return result;
  }

  async drain() {
    this.stopped = true;
    await this.pending;
  }

  releaseKernelClaims() {
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
      requireSameGit(state.repository);

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
          verifyContextHashes(record.contextHashes);

          if (record.status !== "admitted" || !record.binding)
            throw new Error("Unresolved workspace admission intent");
          requireSameGit(record.binding);
        }

        if (state.effects.some((effect) => effect.status !== "observed"))
          throw new Error("Unresolved workspace effect intent");

        for (let index = 0; index < active.length; index++) {
          const record = active[index];
          const claim = acquired[index];

          if (record && claim) this.claims.set(record.id, claim);
        }
      } catch (error) {
        for (const claim of acquired) claim.release();
        throw error;
      }
    } catch (error) {
      this.blocker = error instanceof Error ? error.message : "Workspace admission is blocked";
    }
  }

  admit(
    repositoryInput: GitBinding,
    approvalInputs: readonly AssignmentApproval[],
    authority: string,
    context: Context,
  ) {
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
      requireSameGit(repository);

      if (state?.repository) requireSameGit(state.repository, repository);

      for (const record of active) requireOwnedAssignment(this.host, record, repository);
      const paths = active.map((record) => record.worktree);
      const branches = new Set(active.map((record) => record.branch));
      const ids = new Set(state?.assignments.map((record) => record.id));
      const gate = await acquireAdmissionGate(repository.commonDirectory);

      try {
        requireSameGit(repository);
        const ordered = [...approvals].sort(compareWorktrees);

        for (const approval of ordered) {
          canonicalTarget(approval.worktree);

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

          git(repository.worktree, ["check-ref-format", "--branch", approval.branch]);

          if (!/^[0-9a-f]{40,64}$/.test(approval.base))
            throw new Error("Assignment base must be a pinned commit");
          git(repository.worktree, ["rev-parse", "--verify", `${approval.base}^{commit}`]);
          requireWriteScope(approval.writePaths);
          verifyContextHashes(approval.contextHashes);

          if (approval.kind === "create") {
            if (
              lstatSync(approval.worktree, { throwIfNoEntry: false }) ||
              git(repository.worktree, ["branch", "--list", approval.branch]).trim()
            ) {
              throw new Error("Worktree creation never replaces an existing directory or branch");
            }
          } else {
            requireSameGit(approval.binding);

            if (
              approval.binding.worktree !== approval.worktree ||
              approval.binding.commonDirectory !== repository.commonDirectory ||
              approval.binding.branch !== approval.branch
            ) {
              throw new Error("Existing worktree does not match the approved repository/branch");
            }

            git(approval.worktree, ["merge-base", "--is-ancestor", approval.base, "HEAD"]);
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
            requireSameGit(repository);
            canonicalTarget(approval.worktree);
            writeRecord(join(record.claimDirectory, "reservation.json"), record.reservation);

            if (approval.kind === "create")
              git(repository.worktree, [
                "worktree",
                "add",
                "-b",
                approval.branch,
                approval.worktree,
                approval.base,
              ]);
            record.binding = inspectGit(approval.worktree);

            if (approval.kind === "existing") requireSameGit(approval.binding, record.binding);

            if (
              record.binding.commonDirectory !== repository.commonDirectory ||
              record.binding.branch !== approval.branch ||
              (approval.kind === "create" && record.binding.head !== approval.base)
            )
              throw new Error("Created worktree binding is inconsistent");
          }

          requireSameGit(repository);
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
          const latest = await this.host.harness.snapshot(
            WorkspacesDoc,
            withoutAbortSignal(context),
          );

          if (latest?.effects.some((effect) => effect.status === "intent"))
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
    return this.exclusive(async () => {
      const state = await this.host.harness.snapshot(WorkspacesDoc, context);

      if (!state?.repository) throw new Error("No workspace admission to reconcile");

      if (state.assignments.filter((record) => record.status !== "released").length > 2)
        throw new Error("Too many active writable assignments");
      requireSameGit(state.repository);
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
          const binding = inspectGit(record.worktree);

          if (
            binding.commonDirectory !== state.repository.commonDirectory ||
            binding.branch !== record.branch ||
            (record.binding &&
              (binding.device !== record.binding.device || binding.inode !== record.binding.inode))
          )
            throw new Error("Moved/replaced or unrelated worktree cannot be reconciled");
          git(record.worktree, ["merge-base", "--is-ancestor", record.base, "HEAD"]);
          verifyContextHashes(record.contextHashes);
          const inspection = await inspectRelease(binding, record.reservation);
          const proof = confirmInspection(inspection, await confirm(inspection));
          evidence.push(JSON.stringify(proof));
          bindings.set(record.id, binding);
        }

        for (const binding of bindings.values()) requireSameGit(binding);
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
      } finally {
        for (const claim of acquired.values()) claim.release();
      }
    });
  }

  release(id: string, confirm: ConfirmInspection, context: Context) {
    return this.exclusive(async () => {
      const state = await this.host.harness.snapshot(WorkspacesDoc, context);
      const record = state?.assignments.find((entry) => entry.id === id);

      if (
        !record ||
        !record.binding ||
        !state?.repository ||
        record.status === "pending" ||
        this.blocker ||
        state.effects.some((effect) => effect.status === "intent")
      )
        throw new Error("Only the owning resolved assignment can release its worktree");

      requireOwnedAssignment(this.host, record, state.repository);
      const borrowed = this.claims.get(id);

      if (!borrowed && record.status !== "released")
        throw new Error("Assignment claim is not held");

      const claim =
        borrowed ?? (await acquireClaim(state.repository.commonDirectory, record.worktree, false));

      try {
        requireReservation(record, claim);
        requireSameGit(record.binding);
        const inspection = await inspectRelease(record.binding, record.reservation);
        const proof = confirmInspection(inspection, await confirm(inspection));
        context.abortSignal?.throwIfAborted();
        const releaseId = randomUUID();
        await this.host.harness.commit(async (tx) => {
          const document = await tx.doc(WorkspacesDoc);
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
      } finally {
        if (!borrowed) claim.release();
      }
    });
  }
}
