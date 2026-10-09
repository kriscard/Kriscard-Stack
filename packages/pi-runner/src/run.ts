import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
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

const context = BACKGROUND_CONTEXT;
const modeRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../skills/dev/kriscard-mode",
);

type Models = ReturnType<typeof builtinModels>;

export type RunOptions = {
  prompt: string;
  cwd: string;
  model: string;
  stateFile?: string;
  models?: Models;
};

export function defaultStateFile(cwd: string): string {
  const dataRoot =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  const project = createHash("sha256")
    .update(resolve(cwd))
    .digest("hex")
    .slice(0, 12);
  return join(dataRoot, "kriscard-stack", `${project}.sqlite`);
}

export function parseModel(value: string): {
  provider: string;
  modelId: string;
} {
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

export async function runKriscard(options: RunOptions): Promise<string> {
  const stateFile = options.stateFile ?? defaultStateFile(options.cwd);
  await mkdir(dirname(stateFile), { recursive: true });

  const mode = await readFile(join(modeRoot, "SKILL.md"), "utf8");
  const instructions = `${mode}\n\n## Runtime\n\nYou are the durable Pi agent for this working directory. Read the selected playbook from ${join(modeRoot, "playbooks")}. General skills are installed under ~/.pi/agent/skills or ~/.agents/skills; read only the skills selected by the playbook. Use the coding tools directly. The Pi Durable harness owns persistence and resume; do not invent another state store, control plane, API, or migration layer.`;

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    defineExtension({
      name: "kriscard-mode",
      sections: [section("kriscard-mode", () => instructions, { tag: false })],
    }),
  );

  const models = options.models ?? builtinModels();
  const env = ({ cwd = options.cwd }: { readonly cwd?: string }) =>
    new NodeExecutionEnv({ cwd });
  const storage = await openNodeSqliteStorage(stateFile);
  const harness = await Harness.open(
    storage,
    { models, registry, env },
    context,
  );

  try {
    const root = await harness.root(context, {
      agent: { model: parseModel(options.model), cwd: options.cwd },
    });
    harness.resume();

    const submission = await root.submit(
      { type: "input", content: options.prompt },
      context,
    );
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
    const answer = entry?.model?.[0] as AssistantMessage | undefined;
    if (!answer) throw new Error("Agent completed without an assistant answer");

    return answer.content
      .flatMap((content) => (content.type === "text" ? [content.text] : []))
      .join("");
  } finally {
    await harness.close(context);
  }
}
