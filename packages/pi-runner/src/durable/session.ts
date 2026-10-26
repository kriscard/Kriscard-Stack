import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  DefaultResourceLoader,
  formatSkillsForPrompt,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Conversation,
  createRegistry,
  defineExtension,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { flock } from "fs-ext";

import { KRISCARD_MODE_DIRECTIVE, resolveKriscardModePath } from "../launcher.js";
import { WorkerTools } from "./workers.js";

export const context = BACKGROUND_CONTEXT;

export type SessionOptions = {
  cwd: string;
  sessionPath: string;
  model?: string;
  modePath?: string;
};

export type DurableSession = { harness: Harness; root: Conversation; close: () => Promise<void> };

export async function openSession(options: SessionOptions): Promise<DurableSession> {
  const cwd = resolve(options.cwd);
  const agentDir = getAgentDir();
  const modePath = options.modePath ?? resolveKriscardModePath();
  const settings = SettingsManager.create(cwd, agentDir);
  const models = await ModelRuntime.create();
  const configurationError = models.getError();

  if (configurationError) throw new Error(configurationError);

  const selected = resolveCliModel({
    cliProvider: options.model ? undefined : settings.getDefaultProvider(),
    cliModel: options.model ?? settings.getDefaultModel(),
    modelRuntime: models,
  });

  if (selected.error) throw new Error(selected.error);

  if (selected.warning) throw new Error(selected.warning);

  const model = selected.model ?? models.getAvailableSnapshot()[0];

  if (!model)
    throw new Error("No model configured. Choose a model with Pi before starting Kstack.");

  const prompts = new Map<string, Promise<string>>();

  const prompt = (directory: string) => {
    let value = prompts.get(directory);

    if (!value) {
      value = (async () => {
        const resources = new DefaultResourceLoader({
          cwd: directory,
          agentDir,
          additionalSkillPaths: [dirname(modePath)],
          noExtensions: true,
          noPromptTemplates: true,
          noThemes: true,
        });

        await resources.reload();

        return [
          "You are Kriscard's coding agent. Work in the requested repository and follow its instructions.",
          KRISCARD_MODE_DIRECTIVE,
          `Read the mode skill at ${join(modePath, "SKILL.md")}.`,
          resources.getSystemPrompt(),
          ...resources.getAppendSystemPrompt(),
          ...resources
            .getAgentsFiles()
            .agentsFiles.map((file) => `# ${file.path}\n${file.content}`),
          formatSkillsForPrompt(resources.getSkills().skills),
        ]
          .filter(Boolean)
          .join("\n\n");
      })();
      prompts.set(directory, value);
    }

    return value;
  };

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(WorkerTools);
  registry.install(
    defineExtension({
      name: "kstack.workflow",
      sections: [section("workflow", (input) => prompt(input.agent.cwd ?? cwd), { tag: false })],
    }),
  );

  const databasePath = resolve(cwd, options.sessionPath);
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const owner = await open(`${databasePath}.lock`, "a", 0o600);

  // A SQLite-backed Harness needs one live owner. The kernel releases this lock on process exit.
  try {
    await new Promise<void>((done, reject) => {
      flock(owner.fd, "exnb", (error) => (error ? reject(error) : done()));
    });
  } catch (error) {
    await owner.close();
    throw new Error(`Cannot own session ${databasePath}; another Kstack may be running.`, {
      cause: error,
    });
  }

  const storage = await openNodeSqliteStorage(databasePath).catch(async (error) => {
    await owner.close();
    throw error;
  });

  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? cwd }),
    },
    context,
  ).catch(async (error) => {
    try {
      await storage.close(context);
    } finally {
      await owner.close();
    }

    throw error;
  });

  try {
    const root = await harness.root(context, {
      agent: {
        cwd,
        model: { provider: model.provider, modelId: model.id },
        thinkingLevel: selected.thinkingLevel ?? settings.getDefaultThinkingLevel(),
      },
    });

    const agent = await root.agent(context);

    if (agent.cwd !== cwd) throw new Error(`Session belongs to ${agent.cwd}, not ${cwd}`);

    if (options.model) {
      await root.configure(
        {
          model: { provider: model.provider, modelId: model.id },
          thinkingLevel: selected.thinkingLevel,
        },
        context,
      );
    }

    await prompt(cwd);

    return {
      harness,
      root,
      async close() {
        try {
          await harness.close(context);
        } finally {
          await owner.close();
        }
      },
    };
  } catch (error) {
    try {
      await harness.close(context);
    } finally {
      await owner.close();
    }

    throw error;
  }
}

export async function settle(session: DurableSession): Promise<void> {
  for (;;) {
    const inspection = await session.harness.inspect(context);
    const blocked = inspection.tasks.find((task) => task.state.kind === "blocked");

    if (blocked) throw new Error(`Task ${blocked.record.id} is blocked: ${blocked.state.kind}`);

    if (!inspection.tasks.length) return;

    await Promise.all(
      inspection.tasks.map((task) => session.harness.waitForTask(task.record.id, context)),
    );
  }
}
