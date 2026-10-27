import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { DurableOptions } from "./durable/terminal.js";
import {
  applySetupPlan,
  createSetupPlan,
  formatSetupPlan,
  type CommandRunner,
  runCommand,
} from "./installer.js";
import {
  buildPiArguments,
  type PiRunner,
  resolveKriscardModePath,
  runNativePi,
} from "./launcher.js";

export type CliCommand =
  | { type: "help" }
  | { type: "pi"; arguments: string[]; print: boolean }
  | { type: "durable"; sessionPath: string; model?: string; prompt?: string; print: boolean }
  | { type: "setup" | "update"; yes: boolean };

export type CliDependencies = {
  cwd: string;
  model?: string;
  modePath?: string;
  input: Readable & { isTTY?: boolean };
  output: Writable;
  error: Writable;
  commandRunner: CommandRunner;
  runPi: PiRunner;
  runDurable?: (options: DurableOptions) => Promise<number>;
};

const help = `Usage:
  kstack [native Pi options] ["<request>"]
  kstack run [native Pi options] "<request>"
  kstack durable run [--session <sqlite-file>] [--model <provider/model>] "<task packet>"
  kstack durable [--session <sqlite-file>] [--model <provider/model>]
  kstack setup [--yes]
  kstack update [--yes]

Kstack opens interactive Pi with Kriscard Mode. Pi owns the UI and main session;
skills and playbooks own the workflow. Native Pi options pass through unchanged.
The run command uses native Pi print mode. kstack pi remains an explicit alias.
The orchestration skill uses the explicit durable backend for approved execution.
Durable SQLite state is separate from native Pi's JSONL sessions.`;

function yesOption(args: string[]): boolean {
  const index = args.indexOf("--yes");

  if (index === -1) return false;

  args.splice(index, 1);

  return true;
}

export function parseCommand(argv: readonly string[]): CliCommand {
  const args = [...argv];

  if (args[0] === "pi") return { type: "pi", arguments: args.slice(1), print: false };

  if (args.includes("--help") || args.includes("-h")) return { type: "help" };

  const command = args[0];

  if (command === "setup" || command === "update") {
    args.shift();
    const yes = yesOption(args);

    if (args.length) throw new Error(`${command} does not accept other arguments`);

    return { type: command, yes };
  }

  if (command !== "durable") {
    const print = command === "run";

    if (print) args.shift();

    if (print && !args.length) throw new Error("run requires a request");

    return { type: "pi", arguments: args, print };
  }

  args.shift();
  const print = args[0] === "run";

  if (print) args.shift();
  let sessionPath = ".kstack/session.sqlite";
  let model: string | undefined;
  const prompt: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const value = args[index];

    if (value === "--session" || value === "--model") {
      const argument = args[++index];

      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a value`);

      if (value === "--session") sessionPath = argument;
      else model = argument;
    } else if (value === "--") {
      prompt.push(...args.slice(index + 1));
      break;
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown Kstack option: ${value}. Use kstack pi for native Pi options.`);
    } else {
      prompt.push(value);
    }
  }

  if (print && !prompt.length) throw new Error("run requires a request");

  return { type: "durable", sessionPath, model, prompt: prompt.join(" ") || undefined, print };
}

async function confirm(question: string, dependencies: CliDependencies): Promise<boolean> {
  const readline = createInterface({
    input: dependencies.input,
    output: dependencies.output,
  });

  try {
    const answer = await readline.question(`${question} [y/N] `);

    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function main(
  argv: readonly string[],
  dependencies: Partial<CliDependencies> = {},
): Promise<number> {
  const resolved: CliDependencies = {
    cwd: dependencies.cwd ?? process.cwd(),
    model: dependencies.model ?? (process.env.KRISCARD_MODEL || undefined),
    modePath: dependencies.modePath,
    input: dependencies.input ?? process.stdin,
    output: dependencies.output ?? process.stdout,
    error: dependencies.error ?? process.stderr,
    commandRunner: dependencies.commandRunner ?? runCommand,
    runPi: dependencies.runPi ?? runNativePi,
    runDurable: dependencies.runDurable,
  };

  try {
    const command = parseCommand(argv);

    if (command.type === "help") {
      resolved.output.write(`${help}\n`);

      return 0;
    }

    if (command.type === "pi") {
      const modePath = resolved.modePath ?? resolveKriscardModePath();

      const arguments_ = buildPiArguments({
        arguments: command.arguments,
        modePath,
        model: resolved.model,
        print: command.print,
      });

      return await resolved.runPi(arguments_, resolved.cwd);
    }

    if (command.type === "durable") {
      const runDurable = resolved.runDurable ?? (await import("./durable/terminal.js")).runDurable;

      return await runDurable({
        cwd: resolved.cwd,
        sessionPath: command.sessionPath,
        model: command.model ?? resolved.model?.replace(":", "/"),
        modePath: resolved.modePath,
        prompt: command.prompt,
        print: command.print,
        input: resolved.input,
        output: resolved.output,
        error: resolved.error,
      });
    }

    const plan = await createSetupPlan(resolved.commandRunner);
    resolved.output.write(
      `${formatSetupPlan(plan, command.type === "setup" ? "Setup" : "Update")}\n`,
    );

    if (plan.conflicts.length) {
      throw new Error("Setup cannot continue with skill ownership conflicts");
    }

    if (!command.yes && !(await confirm("Apply these global changes?", resolved))) {
      resolved.output.write("Cancelled.\n");

      return 0;
    }

    await applySetupPlan(plan, resolved.commandRunner, (value) => resolved.output.write(value));
    resolved.output.write(`${command.type === "setup" ? "Setup" : "Update"} complete.\n`);

    return 0;
  } catch (error) {
    resolved.error.write(`${error instanceof Error ? error.message : String(error)}\n`);

    return 1;
  }
}
