import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  LiveDoc,
  type ConversationId,
  type EntryId,
} from "@earendil-works/pi-durable";

// Adapted from Pi Durable's 22-subagent-background example.
export const Workers = defineDoc<{
  agents: Record<string, { conversationId: ConversationId; cwd: string; reported: EntryId[] }>;
}>({
  kind: "kstack.workers",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  checkpointWhen: () => false,
  initial: () => ({ agents: {} }),
});

const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "kstack.worker-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        context,
      ),
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export const Reporter = defineTask<
  { name: string; conversationId: ConversationId; message: string; followUp: boolean },
  { phase: "deliver" } | { phase: "report"; report?: string },
  null
>({
  name: "kstack.worker-reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (task, runtime, context) => {
      const worker = await runtime.conversation(task.input.conversationId, context);

      if (!worker) throw new Error(`Worker disappeared: ${task.input.name}`);

      const submission = await worker.submit(
        {
          type: "input",
          content: task.input.message,
          whenBusy: task.input.followUp ? "followUp" : "steer",
          requestId: `worker-input:${task.id}`,
        },
        context,
      );

      const result = await submission.wait(context);

      await runtime.commit(async (tx) => {
        let report: string | undefined;

        if (result.status === "unanswered") {
          report = `[worker ${task.input.name}: ${result.reason}]`;
        } else if (result.type === "input") {
          const state = await tx.doc(Workers, runtime.conversationId);
          const agent = state.agents[task.input.name];

          if (!agent.reported.includes(result.answer)) {
            const answer = await tx.entry(AssistantEntry, result.answer);
            const message = answer?.model?.[0];

            const text =
              message?.role === "assistant"
                ? message.content
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("")
                : "";

            agent.reported.push(result.answer);
            report = `[worker ${task.input.name} result]\n${text}`;
          }
        }

        return { status: "running", checkpoint: { phase: "report", report } };
      }, context);
    },
    report: async (task, runtime, context) => {
      if (task.state.checkpoint.report !== undefined) {
        const main = await runtime.conversation(runtime.conversationId, context);

        if (!main) throw new Error("Main conversation disappeared");

        await main.submit(
          {
            type: "input",
            content: task.state.checkpoint.report,
            whenBusy: "followUp",
            requestId: `worker-report:${task.id}`,
          },
          context,
        );
      }

      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        context,
      );
    },
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const subagent = defineTool({
  name: "subagent",
  description:
    "Manage persistent background workers. Spawn needs a unique name, message and existing cwd. Send steers by default; followUp queues instead. Stop aborts current work, preserving the conversation. Status lists workers. Answers arrive as follow-up inputs after your current answer. Finish your answer after spawning or sending; the SDK starts the next turn when a report arrives. Follow kstack-orchestrator for workflow and Git isolation.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("stop"),
      Type.Literal("status"),
    ]),
    name: Type.Optional(Type.String({ minLength: 1 })),
    message: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
    followUp: Type.Optional(Type.Boolean()),
  }),
  replay: "unsafe",
  execute: async (args, api, context) => {
    const reply = (text: string) => ({ output: [{ type: "text" as const, text }] });
    const state = await api.snapshot(Workers, api.conversationId, context);

    if (args.action === "status") {
      const lines: string[] = [];

      for (const [name, worker] of Object.entries(state?.agents ?? {})) {
        const live = await api.snapshot(LiveDoc, worker.conversationId, context);
        lines.push(
          `${name}: ${live?.run ? "working" : "idle"} | ${worker.conversationId} | ${worker.cwd}`,
        );
      }

      return reply(lines.join("\n") || "No workers.");
    }

    const { name, message } = args;

    if (!name) throw new Error(`${args.action} needs a name`);

    const worker = state && Object.hasOwn(state.agents, name) ? state.agents[name] : undefined;

    if (args.action === "stop") {
      if (!worker) throw new Error(`No worker named ${name}`);
      await (await api.conversation(worker.conversationId, context))?.abort(context);

      return reply(`Stopped ${name}.`);
    }

    if (!message) throw new Error(`${args.action} needs a message`);

    if (args.action === "spawn" && worker) throw new Error(`${name} already exists; use send`);

    if (args.action === "send" && !worker) throw new Error(`No worker named ${name}`);

    const parent = await api.agent(context);
    const cwd = await realpath(resolve(parent.cwd ?? ".", args.cwd ?? "."));

    await api.commit(async (tx) => {
      const registry = await tx.doc(Workers, api.conversationId);
      const background = { ownership: { kind: "conversation" }, background: true } as const;

      if (args.action === "spawn") {
        if (Object.hasOwn(registry.agents, name))
          throw new Error(`${name} already exists; use send`);
        const anchor = await tx.createTask(Anchor, null, background);
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });

        await configure(tx, child.id, {
          cwd,
          extensions: { remove: [WorkerTools] },
          instructions: `You are worker ${name}. Follow Kriscard Mode for your assigned outcome. Return evidence to the main agent. Do not delegate or expand scope.`,
        });
        registry.agents[name] = { conversationId: child.id, cwd, reported: [] };
      }

      await tx.createTask(
        Reporter,
        {
          name,
          conversationId: registry.agents[name].conversationId,
          message,
          followUp: args.followUp === true,
        },
        background,
      );
    }, context);

    return reply(`${args.action === "spawn" ? "Started" : "Sent to"} ${name}.`);
  },
});

export const WorkerTools = defineExtension({
  name: "kstack.workers",
  tasks: [Anchor, Reporter],
  tools: [subagent],
});
