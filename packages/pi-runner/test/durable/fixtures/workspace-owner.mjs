import { basename, join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";

import { DurableTaskHost } from "../../../dist/durable/task-host.js";
import { inspectGit } from "../../../dist/durable/workspace-git.js";

const [root, repository, worktree] = process.argv.slice(2);

const binding = inspectGit(repository);

const host = await DurableTaskHost.start(
  { repositoryRoot: repository, stateDir: join(root, "state"), models: createModels() },
  BACKGROUND_CONTEXT,
);

await host.workspaces.admit(
  binding,
  [
    {
      kind: "create",
      id: basename(worktree),
      worktree,
      branch: `feature/${basename(worktree)}`,
      base: binding.head,
      writePaths: ["file.txt"],
      contextHashes: [],
    },
  ],
  "Explicit disposable-process-fixture operator approval",
  BACKGROUND_CONTEXT,
);

if (process.argv[5] === "drop-claims") host.workspaces.releaseKernelClaims();

console.log(`ready ${host.taskId}`);

process.stdin.resume();

process.stdin.on("end", async () => {
  await host.close(BACKGROUND_CONTEXT);
  process.exitCode = 0;
});
