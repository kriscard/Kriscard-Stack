import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";

import { defineDoc } from "@earendil-works/pi-durable";

import { gitExecutionControl, type GitExecutionControl } from "./git-execution.js";
import type { Reservation } from "./workspace-claims.js";
import type { GitBinding } from "./workspace-git.js";

export type ContextHash = { path: string; sha256: string };

export type AssignmentApproval = {
  id: string;
  worktree: string;
  branch: string;
  base: string;
  writePaths: readonly string[];
  contextHashes: readonly ContextHash[];
} & ({ kind: "create" } | { kind: "existing"; binding: GitBinding });

export type AssignmentRecord = {
  id: string;
  worktree: string;
  branch: string;
  base: string;
  writePaths: string[];
  contextHashes: ContextHash[];
  claimDirectory: string;
  reservation: Reservation;
  status: "pending" | "admitted" | "released";
  binding: GitBinding | null;
};

export type WorkspaceEffect = {
  id: string;
  operation: "admit" | "reconcile" | "release";
  assignmentIds: string[];
  status: "intent" | "observed";
  authority: string;
  evidence: string | null;
};

export type WorkspaceState = {
  repository: GitBinding | null;
  assignments: AssignmentRecord[];
  effects: WorkspaceEffect[];
};

export const WorkspacesDoc = defineDoc<WorkspaceState>({
  kind: "kstack.workspaces",
  version: 1,
  scope: "session",
  initial: () => ({ repository: null, assignments: [], effects: [] }),
  checkpointWhen: () => true,
});

export async function verifyContextHashes(
  sources: readonly ContextHash[],
  control: GitExecutionControl = gitExecutionControl(),
) {
  const { deadline, signal } = control;
  const names = new Set<string>();

  for (const source of sources) {
    signal.throwIfAborted();

    if (Date.now() >= deadline) throw new Error("Context fingerprint deadline expired");

    if (
      names.has(source.path) ||
      (await realpath(source.path)) !== source.path ||
      !/^[0-9a-f]{64}$/.test(source.sha256) ||
      createHash("sha256")
        .update(await readFile(source.path, { signal }))
        .digest("hex") !== source.sha256
    ) {
      throw new Error("Approved context/source hash is stale or invalid");
    }

    signal.throwIfAborted();

    if (Date.now() >= deadline) throw new Error("Context fingerprint deadline expired");
    names.add(source.path);
  }
}
