import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { defineExtension, defineTask, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";

import { DurableTaskHost } from "../../../dist/durable/task-host.js";

const Marker = defineTask({
  name: "kstack.ownership-marker",
  version: 1,
  initial: () => ({ phase: "write" }),
  phases: {
    write: async (task, runtime, context) => {
      writeFileSync(task.input.path, "executed");
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        context,
      );
    },
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const [operation, stateDir, argument, marker] = process.argv.slice(2);

if (!stateDir || !argument) throw new Error("Expected state directory and repository/task ID");

try {
  const options = {
    stateDir: operation === "default-start" ? undefined : stateDir,
    models: createModels(),
    extensions: [defineExtension({ name: "ownership-test", tasks: [Marker] })],
  };

  const host =
    operation === "start" || operation === "seed" || operation === "default-start"
      ? await DurableTaskHost.start({ ...options, repositoryRoot: argument }, BACKGROUND_CONTEXT)
      : await DurableTaskHost.reopen({ ...options, taskId: argument }, BACKGROUND_CONTEXT);

  if (operation === "seed") {
    if (!marker) throw new Error("Expected marker path");
    await host.harness.commit(async (tx) => {
      await tx.appendEntry(ROOT_CONVERSATION_ID, {
        kind: "kstack.ownership-acknowledgement",
        data: { text: "committed before kill" },
      });
      await tx.createTask(
        Marker,
        { path: marker },
        {
          conversationId: ROOT_CONVERSATION_ID,
          ownership: { kind: "conversation" },
        },
      );
    }, BACKGROUND_CONTEXT);
  }

  if (operation === "probe") {
    await host.close(BACKGROUND_CONTEXT);
    console.log("opened");
  } else {
    console.log(`ready ${host.taskId}`);
    const input = createInterface({ input: process.stdin });
    input.on("close", async () => {
      await host.close(BACKGROUND_CONTEXT);
    });
  }
} catch (error) {
  console.log(`error ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exitCode = 2;
}
