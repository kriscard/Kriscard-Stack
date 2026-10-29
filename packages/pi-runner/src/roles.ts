import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type Message, type Models } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTool,
  Harness,
  section,
  type ModelRef,
  type Conversation,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools, createReadTool } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT;

// Example 26: this is a draft document, never an approval certificate.
export const PlanDoc = defineDoc<{ steps: string[] }>({
  checkpointWhen: () => false,
  kind: "app.plan",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ steps: [] }),
});

const submitPlan = defineTool({
  name: "submit_plan",
  description: "Submit draft steps for discussion in native Pi, not permission to implement.",
  parameters: Type.Object({ steps: Type.Array(Type.String()) }),
  execute: async (args, api, callContext) => {
    await api.commit(async (tx) => {
      (await tx.doc(PlanDoc, api.conversationId)).steps = args.steps;
    }, callContext);

    return {
      output: [{ type: "text", text: "Draft plan submitted." }],
      control: { terminate: true },
    };
  },
});

const Planner = defineExtension({
  name: "planner",
  tools: [submitPlan],
  sections: [
    section(
      "plan_mode",
      () =>
        "You are a read-only planner. Read applicable AGENTS.md and task-provided project instructions. " +
        "Inspect the project, then call submit_plan with draft steps. Change nothing. " +
        "If necessary input or a consequential decision is missing, return questions instead of inventing it. " +
        "Native Pi owns spec artifacts and user approvals. Do not delegate or implement.",
    ),
    section("cwd", (input) => input.env?.cwd),
  ],
});

const Implementer = defineExtension({
  name: "implementer",
  sections: [
    section(
      "role",
      () =>
        "You implement only the explicitly approved task supplied by native Pi. Read applicable AGENTS.md, " +
        "project instructions and the referenced approved artifacts before editing. " +
        "If approval/input is missing or the work requires a consequential deviation, return questions/blockers. " +
        "Use the standard coding tools in the selected project. Report changes, actual commands/results and limitations. " +
        "Native Pi owns workflow decisions and user approvals; do not delegate or start an automatic review/fix loop.",
    ),
    section("cwd", (input) => input.env?.cwd),
  ],
});

const Reviewer = defineExtension({
  name: "reviewer",
  sections: [
    section(
      "role",
      () =>
        "You are a read-only reviewer. Read applicable AGENTS.md, supplied project instructions and the bounded diff/files. " +
        "Report actionable findings with file/line evidence, or an evidence-backed no-findings answer and limitations. " +
        "Never edit, execute shell commands, approve repairs or delegate. Native Pi owns adjudication and the next user decision. " +
        "Finish this requested pass; another pass requires an explicit request.",
    ),
    section("cwd", (input) => input.env?.cwd),
  ],
});

export type RoleName = "planner" | "implementer" | "reviewer";

export type RoleSession = {
  role: RoleName;
  harness: Awaited<ReturnType<typeof Harness.open>>;
  root: Conversation;
  models: Models;
  close(): Promise<void>;
};

/** Open an example-based role over example 12's storage. One live owner per file; caller must close it. */
export async function openRole(
  role: RoleName,
  databasePath: string,
  cwd: string,
  models: Models,
  model: ModelRef,
): Promise<RoleSession> {
  const registry = createRegistry();
  const extension = role === "planner" ? Planner : role === "reviewer" ? Reviewer : Implementer;
  registry.install(CodingTools);
  registry.install(extension);
  const env = new NodeExecutionEnv({ cwd });

  const harness = await Harness.open(
    await openNodeSqliteStorage(databasePath),
    { models, registry, settings: { extensions: [CodingTools] }, env: () => env },
    context,
  );

  try {
    await chmod(databasePath, 0o600);

    const root = await harness.root(context, {
      agent: {
        model,
        cwd,
        extensions: [CodingTools, extension],
        tools:
          role === "planner"
            ? [createReadTool(), submitPlan]
            : role === "reviewer"
              ? [createReadTool()]
              : null,
      },
    });

    const saved = await root.agent(context);

    if (saved.cwd !== resolve(cwd)) {
      throw new Error(
        `Saved ${role} belongs to another project. Open its original project or a new native session.`,
      );
    }

    return {
      role,
      harness,
      root,
      models,
      async close() {
        try {
          await harness.close(context);
        } finally {
          await env.cleanup(context);
        }
      },
    };
  } catch (error) {
    await harness.close(context);
    await env.cleanup(context);
    throw error;
  }
}

function messageText(message: Message): string {
  if (message.role === "system") return "";

  const failure =
    message.role === "assistant" &&
    (message.stopReason === "error" || message.stopReason === "aborted")
      ? `[${message.stopReason}] ${message.errorMessage ?? ""}\n`
      : message.role === "toolResult" && message.isError
        ? "[tool error] "
        : "";

  const content = message.content;

  if (!Array.isArray(content)) return failure + content;

  return (
    failure +
    content
      .flatMap((part) => {
        if (part.type === "text") return [part.text];

        if (part.type === "toolCall") return [`Tool call: ${part.name}`];

        return [];
      })
      .join("\n")
  );
}

/** A task admits new input; undefined explicitly resumes. Cancellation aborts and joins SDK work, not just its wait. */
export async function runRole(
  session: RoleSession,
  task: string | undefined,
  signal?: AbortSignal,
  override?: ModelRef,
): Promise<string> {
  const { role, harness, root, models } = session;
  signal?.throwIfAborted();

  const pending = (await harness.inspect(context)).submissions.find(
    (item) => item.conversationId === root.id && item.type === "input",
  );

  if (task !== undefined && pending) {
    throw new Error(
      `${role} has unfinished saved work. Request resume before assigning a new task.`,
    );
  }

  if (task === undefined && !pending) {
    const draft =
      role === "planner" ? await harness.snapshot(PlanDoc, root.id, context) : undefined;

    const history = await root.entries({}, 20, undefined, context);

    const lines = [...history.items].reverse().map((entry) => {
      const text = entry.model?.map(messageText).filter(Boolean).join("\n");

      return text ? `${entry.kind}: ${text}` : entry.kind;
    });

    const proposal =
      role === "planner"
        ? (draft?.steps.map((step) => `- ${step}`).join("\n") ?? "No saved draft.")
        : "";

    return `Historical ${role} history — no new run:\n${proposal}\n\n${lines.join("\n")}`;
  }

  const model = override ?? (await root.agent(context)).model;

  if (!model || !models.getModel(model.provider, model.modelId)) {
    throw new Error(
      `${role} model unavailable: ${model?.provider}/${model?.modelId}. Configure it in Pi or explicitly select another model.`,
    );
  }

  if (override) await root.configure({ model: override }, context);

  const submission =
    task === undefined && pending
      ? await harness.submission(pending.id, context)
      : await root.submit({ type: "input", content: task ?? "", whenBusy: "reject" }, context);

  if (!submission) throw new Error(`Saved ${role} submission is unavailable.`);

  let abort: Promise<void> | undefined;

  const cancel = () => {
    abort ??= root.abort(context);
  };

  signal?.addEventListener("abort", cancel, { once: true });

  if (signal?.aborted) cancel();

  try {
    const settled = await submission.wait(context);

    if (abort) {
      await abort;
      throw new Error(`${role} cancelled. Saved history is preserved; partial effects may exist.`);
    }

    if (settled.status !== "done" || settled.type !== "input") {
      throw new Error(
        `${role} unanswered: ${settled.status === "unanswered" ? `${settled.reason}: ${JSON.stringify(settled.detail) ?? ""}` : settled.status}`,
      );
    }

    const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    const message = answer?.model?.[0];

    if (!message || message.role !== "assistant")
      throw new Error("SDK answer entry is unavailable.");
    let text = messageText(message);

    if (message.content.some((part) => part.type === "toolCall" && part.name === "submit_plan")) {
      const plan = await harness.snapshot(PlanDoc, root.id, context);
      text = `Draft plan — not approved:\n${plan?.steps.map((step) => `- ${step}`).join("\n") ?? "No draft."}`;
    }

    signal?.throwIfAborted();

    return text;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await abort;
  }
}
