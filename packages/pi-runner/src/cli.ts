import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { ReadStream, WriteStream } from "node:tty";

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
import { reconcileBundledSkillLinks } from "./skill-links.js";
import type { UpdateDisplay } from "./update-ui.js";

export type CliCommand =
  | { type: "help" }
  | { type: "sync-skills" }
  | { type: "pi"; arguments: string[]; print: boolean }
  | { type: "setup" | "update"; yes: boolean; plain: boolean; motion: boolean; verbose: boolean };

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
  kstack [native Pi options] ["<request>"]
  kstack run [native Pi options] "<request>"
  kstack setup [--yes] [--plain] [--no-motion] [--verbose]
  kstack update [--yes] [--plain] [--no-motion] [--verbose]
  kstack sync-skills

Kstack opens interactive Pi with Kriscard Mode. Pi owns the UI and main session;
skills and playbooks own the workflow. Native Pi options pass through unchanged.
The run command uses native Pi print mode. kstack pi remains an explicit alias.
Only update uses Soft Glow in a supported terminal; --plain disables it.
--no-motion keeps static color. --verbose shows subprocess output in plain mode.`;

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);

  if (index === -1) return false;

  args.splice(index, 1);

  return true;
}

export function parseCommand(argv: readonly string[]): CliCommand {
  const args = [...argv];

  if (args[0] === "pi") return { type: "pi", arguments: args.slice(1), print: false };

  if (args.includes("--help") || args.includes("-h")) return { type: "help" };

  const command = args[0];

  if (command === "sync-skills") {
    if (args.length !== 1) throw new Error("sync-skills does not accept arguments");

    return { type: "sync-skills" };
  }

  if (command === "setup" || command === "update") {
    args.shift();
    const yes = takeFlag(args, "--yes");
    const plain = takeFlag(args, "--plain");
    const motion = !takeFlag(args, "--no-motion");
    const verbose = takeFlag(args, "--verbose");

    if (args.length) throw new Error(`${command} does not accept other arguments`);

    return { type: command, yes, plain, motion, verbose };
  }

  if (command === "agents" || command === "durable") {
    throw new Error(
      "The previous Durable integration was removed. No worker runtime is configured.",
    );
  }

  const print = command === "run";

  if (print) args.shift();

  if (print && !args.length) throw new Error("run requires a request");

  return { type: "pi", arguments: args, print };
}

export function updateTerminal(input: Readable, output: Writable) {
  if (!(input instanceof ReadStream) || !(output instanceof WriteStream)) return undefined;

  if (
    !input.isTTY ||
    !output.isTTY ||
    process.env.CI ||
    process.env.NO_COLOR ||
    process.env.TERM === "dumb"
  )
    return undefined;

  return { input, output };
}

async function confirm(
  question: string,
  dependencies: CliDependencies,
  signal: AbortSignal,
): Promise<boolean> {
  const readline = createInterface({
    input: dependencies.input,
    output: dependencies.output,
  });

  try {
    const answer = await readline.question(`${question} [y/N] `, { signal });

    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function maintain(
  command: Extract<CliCommand, { type: "setup" | "update" }>,
  dependencies: CliDependencies,
): Promise<number> {
  const controller = new AbortController();
  const interrupt = () => controller.abort("SIGINT");
  const terminate = () => controller.abort("SIGTERM");

  const terminal =
    command.type === "update" &&
    !command.plain &&
    !command.verbose &&
    process.execArgv.includes("--experimental-ffi")
      ? updateTerminal(dependencies.input, dependencies.output)
      : undefined;

  let display: UpdateDisplay | undefined;
  const operation = command.type === "setup" ? "Setup" : "Update";

  const progress = (label: string) => {
    if (display) display.progress(label);
    else dependencies.output.write(`  ${label}\n`);
  };

  const execution = { signal: controller.signal, onProgress: progress };

  async function openDisplay(): Promise<UpdateDisplay | undefined> {
    if (!terminal) return undefined;

    try {
      const { createUpdateDisplay } = await import("./update-ui.js");

      return await createUpdateDisplay(terminal.input, terminal.output, command.motion, interrupt);
    } catch (error) {
      dependencies.error.write(
        `Native display unavailable; using plain output. ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);

  try {
    display = await openDisplay();
    const plan = await createSetupPlan(dependencies.commandRunner, execution);
    await display?.close();
    display = undefined;
    dependencies.output.write(`${formatSetupPlan(plan, operation)}\n\n`);

    if (plan.conflicts.length)
      throw new Error("Resolve the reported skill ownership conflicts first");
    controller.signal.throwIfAborted();

    if (!command.yes) {
      if (!dependencies.input.isTTY)
        throw new Error("Use --yes to approve global changes without an interactive terminal");

      if (!(await confirm("Apply these global changes?", dependencies, controller.signal))) {
        dependencies.output.write("Cancelled. No installation changes made.\n");

        return 0;
      }
    }

    controller.signal.throwIfAborted();
    display = await openDisplay();
    await applySetupPlan(
      plan,
      dependencies.commandRunner,
      (value) => {
        if (command.verbose) dependencies.output.write(value);
      },
      execution,
    );
    await display?.finish(`${operation} complete`);
    await display?.close();
    display = undefined;
    dependencies.output.write(
      `${operation} complete · CLI installation finished; ${plan.candidates.length} Pi skills verified.\n`,
    );

    return 0;
  } catch (error) {
    await display?.close();
    display = undefined;

    if (!controller.signal.aborted) throw error;
    dependencies.error.write(
      `${operation} cancelled. Completed changes may remain; inspect before retrying.\n`,
    );

    return controller.signal.reason === "SIGTERM" ? 143 : 130;
  } finally {
    await display?.close();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
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
  };

  try {
    const command = parseCommand(argv);

    if (command.type === "help") {
      resolved.output.write(`${help}\n`);

      return 0;
    }

    if (command.type === "sync-skills") {
      const repaired = reconcileBundledSkillLinks(resolved.modePath ?? resolveKriscardModePath());
      resolved.output.write(`Updated ${repaired.length} Kstack skill link(s).\n`);

      return 0;
    }

    if (command.type === "pi") {
      const modePath = resolved.modePath ?? resolveKriscardModePath();
      reconcileBundledSkillLinks(modePath);

      const arguments_ = buildPiArguments({
        arguments: command.arguments,
        modePath,
        model: resolved.model,
        print: command.print,
      });

      return await resolved.runPi(arguments_, resolved.cwd);
    }

    return await maintain(command, resolved);
  } catch (error) {
    resolved.error.write(`${error instanceof Error ? error.message : String(error)}\n`);

    return 1;
  }
}
