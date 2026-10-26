import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

import { requireTaskId } from "./inputs.js";

export type DurableInvocation =
  | { type: "native-escape"; arguments: string[] }
  | { type: "help" }
  | { type: "durable-start"; request: string; model?: string; stateDir?: string }
  | { type: "durable-resume"; taskId: string; stateDir?: string }
  | { type: "durable-release-worktree"; worktree: string };

export function parseDurableInvocation(argv: readonly string[]): DurableInvocation | undefined {
  if (argv[0] === "--") return { type: "native-escape", arguments: argv.slice(1) };

  if (argv[0] !== "durable") return undefined;

  if (argv[1] === "--help" || argv[1] === "-h") return { type: "help" };

  const operation = argv[1];

  if (operation !== "start" && operation !== "resume" && operation !== "release-worktree") {
    throw new Error("durable requires start, resume, or release-worktree");
  }

  const { values, positionals, tokens } = parseArgs({
    args: argv.slice(2),
    allowPositionals: true,
    strict: true,
    tokens: true,
    options: {
      help: { type: "boolean", short: "h" },
      model: { type: "string" },
      "state-dir": { type: "string" },
    },
  });

  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.kind !== "option") continue;

    if (seen.has(token.name)) throw new Error(`Duplicate option: --${token.name}`);
    seen.add(token.name);
  }

  if (values.help) return { type: "help" };

  if (positionals.length !== 1 || !positionals[0]?.trim()) {
    throw new Error(`${operation} requires exactly one nonempty positional argument`);
  }

  const argument = positionals[0];
  const stateDir = values["state-dir"];

  if (stateDir !== undefined && !isAbsolute(stateDir)) {
    throw new Error("--state-dir requires an absolute directory");
  }

  if (values.model !== undefined && !values.model.trim()) {
    throw new Error("--model requires a nonempty model reference");
  }

  if (operation === "start") {
    return { type: "durable-start", request: argument, model: values.model, stateDir };
  }

  if (values.model !== undefined) {
    throw new Error(`--model is not supported for ${operation}`);
  }

  if (operation === "resume") {
    return { type: "durable-resume", taskId: requireTaskId(argument), stateDir };
  }

  if (stateDir !== undefined) {
    throw new Error("release-worktree does not accept --state-dir");
  }

  if (!isAbsolute(argument)) {
    throw new Error("release-worktree requires an absolute worktree path");
  }

  return { type: "durable-release-worktree", worktree: argument };
}
