import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import { acquireSessionLease, defaultStateFile } from "./session.js";

export { defaultStateFile } from "./session.js";

const context = BACKGROUND_CONTEXT;

const repositoryModeRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../skills/dev/kriscard-mode",
);

async function loadMode(): Promise<{ contents: string; root: string }> {
  const candidates = [
    repositoryModeRoot,
    join(homedir(), ".agents", "skills", "kriscard-mode"),
    join(homedir(), ".pi", "agent", "skills", "kriscard-mode"),
  ];

  for (const root of candidates) {
    try {
      return { contents: await readFile(join(root, "SKILL.md"), "utf8"), root };
    } catch (error) {
      // SAFETY: Node filesystem failures expose `code` through ErrnoException.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  throw new Error("The kriscard-mode skill is not installed. Run 'kstack setup' first.");
}

type Models = ReturnType<typeof builtinModels>;

export type SessionExistence = "any" | "must-exist" | "must-not-exist";

export type SessionOptions = {
  cwd: string;
  model: string;
  stateFile?: string;
  models?: Models;
  existence?: SessionExistence;
};

export type RunOptions = SessionOptions & {
  prompt: string;
};

export type ParsedModel = {
  provider: string;
  modelId: string;
};

export function parseModel(value: string): ParsedModel {
  const separator = value.indexOf(":");

  if (separator < 1 || separator === value.length - 1) {
    throw new Error(
      "Model must use <provider>:<model-id>, for example anthropic:claude-sonnet-4-6",
    );
  }

  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

export type KriscardConversation = {
  submit(prompt: string): Promise<string>;
  close(): Promise<void>;
};

export async function openKriscardConversation(
  options: SessionOptions,
): Promise<KriscardConversation> {
  const model = parseModel(options.model);
  const stateFile = options.stateFile ?? defaultStateFile(options.cwd);
  await mkdir(dirname(stateFile), { recursive: true });

  const mode = await loadMode();
  const instructions = `${mode.contents}\n\n## Runtime\n\nYou are the durable Pi agent for this working directory. Read the selected playbook from ${join(mode.root, "playbooks")}. General skills are installed under ~/.pi/agent/skills or ~/.agents/skills; read only the skills selected by the playbook. Before repository work, read the root AGENTS.md when present. Before changing a nested area, check for a closer AGENTS.md; the closest applicable file wins, while the user's explicit request remains higher priority. Never create or modify AGENTS.md as setup. Use the coding tools directly. The Pi Durable harness owns persistence and resume; do not invent another state store, control plane, API, or migration layer.`;

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    defineExtension({
      name: "kriscard-mode",
      sections: [section("kriscard-mode", () => instructions, { tag: false })],
    }),
  );

  const models = options.models ?? builtinModels();
  const env = ({ cwd = options.cwd }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });
  const releaseLease = await acquireSessionLease(stateFile);

  try {
    const exists = existsSync(stateFile);

    if (options.existence === "must-exist" && !exists) {
      throw new Error("Session does not exist");
    }

    if (options.existence === "must-not-exist" && exists) {
      throw new Error("Session already exists");
    }

    const storage = await openNodeSqliteStorage(stateFile);
    const harness = await Harness.open(storage, { models, registry, env }, context);
    let root;

    try {
      root = await harness.root(context, {
        agent: { model, cwd: options.cwd },
      });
      harness.resume();
    } catch (error) {
      await harness.close(context);
      throw error;
    }

    return {
      async submit(prompt: string): Promise<string> {
        const submission = await root.submit({ type: "input", content: prompt }, context);
        const settled = await submission.wait(context);

        if (settled.status !== "done" || settled.type !== "input") {
          throw new Error(
            `Agent did not answer: ${settled.status === "unanswered" ? settled.reason : settled.status}`,
          );
        }

        const entry = await root.commit(
          (transaction) => transaction.entry(AssistantEntry, settled.answer),
          context,
        );

        const answer = entry?.model?.[0];

        if (!answer || answer.role !== "assistant") {
          throw new Error("Agent completed without an assistant answer");
        }

        return answer.content
          .flatMap((content) => (content.type === "text" ? [content.text] : []))
          .join("");
      },
      async close(): Promise<void> {
        try {
          await harness.close(context);
        } finally {
          await releaseLease();
        }
      },
    };
  } catch (error) {
    await releaseLease();
    throw error;
  }
}

export async function initializeKriscard(options: SessionOptions): Promise<void> {
  const conversation = await openKriscardConversation(options);
  await conversation.close();
}

export async function runKriscard(options: RunOptions): Promise<string> {
  const conversation = await openKriscardConversation(options);

  try {
    return await conversation.submit(options.prompt);
  } finally {
    await conversation.close();
  }
}
