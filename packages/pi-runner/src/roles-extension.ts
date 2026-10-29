import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Usage } from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelRef, UsageState } from "@earendil-works/pi-durable";
import { piAgentDirectory } from "./launcher.js";
import { openRole, runRole, type RoleName, type RoleSession } from "./roles.js";

const parameters = Type.Object({
  task: Type.Optional(Type.String({ minLength: 1 })),
  resume: Type.Optional(Type.Boolean()),
  model: Type.Optional(
    Type.Object({
      provider: Type.String({ minLength: 1 }),
      modelId: Type.String({ minLength: 1 }),
    }),
  ),
});

// Native tool results report the SDK's per-call spend, including intermediate turns, without another ledger.
function usageSince(before: UsageState, after: UsageState): Usage {
  const total: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  for (const [direction, state] of [
    [-1, before],
    [1, after],
  ] as const) {
    for (const item of [...Object.values(state.models), ...Object.values(state.tools)]) {
      total.input += direction * item.input;
      total.output += direction * item.output;
      total.cacheRead += direction * item.cacheRead;
      total.cacheWrite += direction * item.cacheWrite;
      total.totalTokens += direction * item.totalTokens;

      if (item.reasoning !== undefined)
        total.reasoning = (total.reasoning ?? 0) + direction * item.reasoning;

      if (item.cacheWrite1h !== undefined)
        total.cacheWrite1h = (total.cacheWrite1h ?? 0) + direction * item.cacheWrite1h;
      total.cost.input += direction * item.cost.input;
      total.cost.output += direction * item.cost.output;
      total.cost.cacheRead += direction * item.cost.cacheRead;
      total.cost.cacheWrite += direction * item.cost.cacheWrite;
      total.cost.total += direction * item.cost.total;
    }
  }

  return total;
}

/** Native Pi owns intake/approvals; SDK state opens only for an explicit role call. */
export default function rolesExtension(pi: ExtensionAPI) {
  const roles = new Map<RoleName, RoleSession>();
  let models: ModelRuntime | undefined;

  const configureProvider = (ctx: ExtensionContext, model: ModelRef) => {
    const provider = ctx.modelRegistry.getProvider(model.provider);

    if (provider) models?.registerNativeProvider(provider);
    const config = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);

    if (config) models?.registerProvider(model.provider, config);
  };

  pi.on("session_shutdown", async () => {
    const current = [...roles.values()];
    roles.clear();
    models = undefined;
    const closed = await Promise.allSettled(current.map((role) => role.close()));

    const errors = closed.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length) throw new AggregateError(errors, "Role cleanup failed");
  });

  for (const definition of [
    {
      role: "planner",
      name: "durable_plan",
      label: "Planner",
      purpose: "Read-only draft planning and questions; a proposal is not approval.",
    },
    {
      role: "implementer",
      name: "durable_implement",
      label: "Implementer",
      purpose:
        "Execute only an explicitly approved task after the native implementation workflow and user confirmation. Return blockers rather than expanding scope.",
    },
    {
      role: "reviewer",
      name: "durable_review",
      label: "Reviewer",
      purpose:
        "A separate read-only review of the supplied diff/files. Return findings and evidence; never repair. Each additional pass requires an explicit request.",
    },
  ] as const) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: `${definition.purpose} Supply a bounded task with project instructions/artifact references, or resume:true for saved work/history. New roles default to the native model; saved roles keep theirs unless a new task explicitly overrides it.`,
      parameters,
      exposure: "model-only",
      annotations: {
        readOnlyHint: definition.role !== "implementer",
        destructiveHint: definition.role === "implementer",
        openWorldHint: true,
      },
      executionMode: "sequential",
      async execute(_callId, args, signal, _onUpdate, ctx) {
        if (
          (args.task !== undefined) === (args.resume === true) ||
          args.task?.trim() === "" ||
          (args.resume && args.model)
        ) {
          throw new Error(
            "Supply either a nonempty task or resume:true; model overrides require a new task.",
          );
        }

        if (definition.role === "implementer" && !ctx.hasUI) {
          throw new Error(
            "The implementer requires native Pi's confirmation-capable UI. Unattended coding approval is not supported.",
          );
        }

        const sessionId = ctx.sessionManager.getSessionId();

        if (!ctx.sessionManager.getSessionFile()) {
          throw new Error(
            "Durable roles require a saved native Pi session. Start or resume a persistent session.",
          );
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(sessionId))
          throw new Error("Invalid native session identity.");
        let role = roles.get(definition.role);

        const selected =
          args.model ?? (ctx.model && { provider: ctx.model.provider, modelId: ctx.model.id });

        if (!role && !selected)
          throw new Error("Select a configured Pi model before opening a role.");
        models ??= await ModelRuntime.create();

        if (selected) configureProvider(ctx, selected);

        if (!role && selected) {
          const directory = join(piAgentDirectory(), "durable-core-roles", sessionId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          role = await openRole(
            definition.role,
            join(directory, `${definition.role}.sqlite`),
            ctx.cwd,
            models,
            selected,
          );
          roles.set(definition.role, role);
        }

        if (!role) throw new Error("Role could not be opened.");
        const agent = await role.root.agent(BACKGROUND_CONTEXT);

        if (agent.model) configureProvider(ctx, agent.model);

        if (definition.role === "implementer") {
          const model = args.model ?? agent.model;

          const confirmed = await ctx.ui.confirm(
            "Run implementer?",
            `${args.task ?? "Resume the unfinished saved assignment/history."}\n\nProject: ${ctx.cwd}\nModel: ${model?.provider}/${model?.modelId}`,
            { signal },
          );

          if (!confirmed) throw new Error("Implementation was not confirmed. No coding started.");
        }

        const before = await role.harness.usage(BACKGROUND_CONTEXT);

        try {
          const text = await runRole(role, args.task, signal, args.model);

          return {
            content: [{ type: "text", text }],
            details: undefined,
            usage: usageSince(before, await role.harness.usage(BACKGROUND_CONTEXT)),
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: String(error) }],
            details: undefined,
            isError: true,
            usage: usageSince(before, await role.harness.usage(BACKGROUND_CONTEXT)),
          };
        }
      },
    });
  }
}
