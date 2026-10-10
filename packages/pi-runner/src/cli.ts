import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

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
};

const help = `Usage:
  kstack [pi options] [initial prompt]
  kstack run [pi options] "<request>"
  kstack setup [--yes]
  kstack update [--yes]

Bare kstack opens native Pi with kriscard-mode enabled. Pi owns its UI, tools,
project instructions, sessions, and resume behavior. Use Pi options such as
--continue, --resume, --session, --session-id, --name, and --model normally.
The run command adds --print for a one-shot request.`;

function yesOption(args: string[]): boolean {
  const index = args.indexOf("--yes");

  if (index === -1) return false;

  args.splice(index, 1);

  return true;
}

export function parseCommand(argv: readonly string[]): CliCommand {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) return { type: "help" };

  const command = args[0];

  if (command === "setup" || command === "update") {
    args.shift();
    const yes = yesOption(args);

    if (args.length) throw new Error(`${command} does not accept other arguments`);

    return { type: command, yes };
  }

  if (command === "run") {
    args.shift();

    if (!args.length) throw new Error("run requires a request");

    return { type: "pi", arguments: args, print: true };
  }

  return { type: "pi", arguments: args, print: false };
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
    model: dependencies.model ?? process.env.KRISCARD_MODEL,
    modePath: dependencies.modePath,
    input: dependencies.input ?? process.stdin,
    output: dependencies.output ?? process.stdout,
    error: dependencies.error ?? process.stderr,
    commandRunner: dependencies.commandRunner ?? runCommand,
    runPi: dependencies.runPi ?? runNativePi,
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

      return resolved.runPi(arguments_, resolved.cwd);
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
