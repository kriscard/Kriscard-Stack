import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";

import { GitExecutionError } from "../../../dist/durable/git-execution.js";
import { DurableTaskHost } from "../../../dist/durable/task-host.js";
import { inspectGit } from "../../../dist/durable/workspace-git.js";
import { WorkspacesDoc } from "../../../dist/durable/workspace-state.js";

const [stateDir, repositoryRoot, worktree] = process.argv.slice(2);

const controller = new AbortController();

process.on("message", () => controller.abort());

const host = await DurableTaskHost.start(
  { repositoryRoot, stateDir, models: createModels() },
  BACKGROUND_CONTEXT,
);

const repository = await inspectGit(repositoryRoot);

try {
  await host.workspaces.admit(
    repository,
    [
      {
        kind: "create",
        id: "writer",
        worktree,
        branch: "feature/writer",
        base: repository.head,
        writePaths: ["file.txt"],
        contextHashes: [],
      },
    ],
    "Controlled unsupported escaped-stream fixture",
    withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
  );
  throw new Error("Expected unresolved Git activity");
} catch (error) {
  if (!(error instanceof GitExecutionError) || error.outcome.quiescent) throw error;
  const state = await host.harness.snapshot(WorkspacesDoc, BACKGROUND_CONTEXT);
  let closeRejected = false;

  try {
    await host.close(BACKGROUND_CONTEXT);
  } catch {
    closeRejected = true;
  }

  console.log(
    JSON.stringify({
      taskId: host.taskId,
      claimDirectory: state.assignments[0].claimDirectory,
      assignmentStatus: state.assignments[0].status,
      effectStatus: state.effects[0].status,
      blockedReason: host.workspaces.blockedReason,
      outcome: error.outcome,
      closeRejected,
    }),
  );
}
// The parent kills this owner only after proving the actual kernel locks remain
// held. This is deliberately NOT a clean close or a recovery/release mechanism.
