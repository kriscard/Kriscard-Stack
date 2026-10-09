import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  applySetupPlan,
  createSetupPlan,
  formatSetupPlan,
  type CommandRunner,
  runCommand,
} from "./installer.js";
import { openKriscardConversation, runKriscard } from "./run.js";
import {
  DEFAULT_SESSION,
  listSessions,
  removeSession,
  selectedStateFile,
  sessionExists,
  validateSessionName,
} from "./session.js";

export type CliCommand =
  | { type: "help" }
  | { type: "interactive"; session: string; requireExisting: boolean }
  | { type: "run"; session: string; prompt: string }
  | { type: "list" }
  | { type: "remove"; session: string; yes: boolean }
  | { type: "setup" | "update"; yes: boolean };

export type CliDependencies = {
  cwd: string;
  model?: string;
  input: Readable & { isTTY?: boolean };
  output: Writable;
  error: Writable;
  commandRunner: CommandRunner;
  openConversation: typeof openKriscardConversation;
  runAgent: typeof runKriscard;
};

const help = `Usage:
  kstack [--session <name>]
  kstack run [--session <name>] "<request>"
  kstack list
  kstack new <name>
  kstack resume <name>
  kstack remove <name> [--yes]
  kstack setup [--yes]
  kstack update [--yes]

The compatibility command 'kriscard "<request>"' remains available.`;

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function sessionOption(args: string[]): string {
  return validateSessionName(optionValue(args, "--session") ?? DEFAULT_SESSION);
}

function yesOption(args: string[]): boolean {
  const index = args.indexOf("--yes");
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function remaining(args: string[]): string[] {
  return args.filter((argument) => argument !== "--");
}

export function parseCommand(argv: readonly string[]): CliCommand {
  const args = [...argv];
  if (args.length === 0) {
    return {
      type: "interactive",
      session: DEFAULT_SESSION,
      requireExisting: false,
    };
  }
  if (args.includes("--help") || args.includes("-h")) return { type: "help" };
  if (args[0] === "--session") {
    const session = sessionOption(args);
    if (remaining(args).length) throw new Error("Unexpected arguments");
    return { type: "interactive", session, requireExisting: false };
  }

  const command = args.shift();
  if (command === "run") {
    const session = sessionOption(args);
    const prompt = remaining(args).join(" ").trim();
    if (!prompt) throw new Error("run requires a request");
    return { type: "run", session, prompt };
  }
  if (command === "list") {
    if (args.length) throw new Error("list does not accept arguments");
    return { type: "list" };
  }
  if (command === "new" || command === "resume") {
    const session = args.shift();
    if (!session || args.length)
      throw new Error(`${command} requires one name`);
    return {
      type: "interactive",
      session: validateSessionName(session),
      requireExisting: command === "resume",
    };
  }
  if (command === "remove") {
    const yes = yesOption(args);
    const session = args.shift();
    if (!session || args.length) throw new Error("remove requires one name");
    return { type: "remove", session: validateSessionName(session), yes };
  }
  if (command === "setup" || command === "update") {
    const yes = yesOption(args);
    if (args.length)
      throw new Error(`${command} does not accept other arguments`);
    return { type: command, yes };
  }

  const prompt = [command, ...remaining(args)].join(" ").trim();
  if (!prompt) throw new Error("A request is required");
  return { type: "run", session: DEFAULT_SESSION, prompt };
}

async function confirm(
  question: string,
  dependencies: CliDependencies,
): Promise<boolean> {
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

function requireModel(dependencies: CliDependencies): string {
  if (dependencies.model) return dependencies.model;
  throw new Error(
    "Set KRISCARD_MODEL to <provider>:<model-id>, for example anthropic:claude-sonnet-4-6",
  );
}

async function submit(
  prompt: string,
  session: string,
  dependencies: CliDependencies,
): Promise<void> {
  const answer = await dependencies.runAgent({
    prompt,
    cwd: dependencies.cwd,
    model: requireModel(dependencies),
    stateFile: selectedStateFile(dependencies.cwd, session),
  });
  dependencies.output.write(`${answer}\n`);
}

async function interactive(
  session: string,
  dependencies: CliDependencies,
): Promise<void> {
  const conversation = await dependencies.openConversation({
    cwd: dependencies.cwd,
    model: requireModel(dependencies),
    stateFile: selectedStateFile(dependencies.cwd, session),
  });
  const readline = createInterface({
    input: dependencies.input,
    output: dependencies.output,
    terminal: Boolean(dependencies.input.isTTY),
  });
  dependencies.output.write(
    `Kstack session '${session}'. Type 'exit' or press Ctrl-D to leave.\n`,
  );
  if (dependencies.input.isTTY) {
    readline.setPrompt("kstack> ");
    readline.prompt();
  }

  try {
    for await (const line of readline) {
      const prompt = line.trim();
      if (/^(?:exit|quit)$/i.test(prompt)) break;
      if (prompt) {
        dependencies.output.write(`${await conversation.submit(prompt)}\n`);
      }
      if (dependencies.input.isTTY) readline.prompt();
    }
  } finally {
    readline.close();
    await conversation.close();
  }
}

export async function main(
  argv: readonly string[],
  dependencies: Partial<CliDependencies> = {},
): Promise<number> {
  const resolved: CliDependencies = {
    cwd: dependencies.cwd ?? process.cwd(),
    model: dependencies.model ?? process.env.KRISCARD_MODEL,
    input: dependencies.input ?? process.stdin,
    output: dependencies.output ?? process.stdout,
    error: dependencies.error ?? process.stderr,
    commandRunner: dependencies.commandRunner ?? runCommand,
    openConversation: dependencies.openConversation ?? openKriscardConversation,
    runAgent: dependencies.runAgent ?? runKriscard,
  };

  try {
    const command = parseCommand(argv);
    if (command.type === "help") {
      resolved.output.write(`${help}\n`);
      return 0;
    }
    if (command.type === "run") {
      await submit(command.prompt, command.session, resolved);
      return 0;
    }
    if (command.type === "interactive") {
      const exists = sessionExists(resolved.cwd, command.session);
      if (command.requireExisting && !exists) {
        throw new Error(`Session '${command.session}' does not exist`);
      }
      if (!command.requireExisting && argv[0] === "new" && exists) {
        throw new Error(`Session '${command.session}' already exists`);
      }
      await interactive(command.session, resolved);
      return 0;
    }
    if (command.type === "list") {
      const sessions = await listSessions(resolved.cwd);
      if (!sessions.length) {
        resolved.output.write("No sessions for this project.\n");
      } else {
        for (const session of sessions) {
          resolved.output.write(
            `${session.name}\t${session.modifiedAt.toISOString()}${session.legacy ? "\tlegacy" : ""}\n`,
          );
        }
      }
      return 0;
    }
    if (command.type === "remove") {
      const path = selectedStateFile(resolved.cwd, command.session);
      resolved.output.write(
        `Remove session '${command.session}':\n  ${path}\n  ${path}-shm\n  ${path}-wal\n  ${path}.lock\n`,
      );
      if (!command.yes && !(await confirm("Continue?", resolved))) {
        resolved.output.write("Cancelled.\n");
        return 0;
      }
      const removed = await removeSession(resolved.cwd, command.session);
      resolved.output.write(`Removed ${removed.length} file(s).\n`);
      return 0;
    }

    const plan = await createSetupPlan(resolved.commandRunner);
    resolved.output.write(
      `${formatSetupPlan(plan, command.type === "setup" ? "Setup" : "Update")}\n`,
    );
    if (plan.conflicts.length) {
      throw new Error("Setup cannot continue with skill ownership conflicts");
    }
    if (
      !command.yes &&
      !(await confirm("Apply these global changes?", resolved))
    ) {
      resolved.output.write("Cancelled.\n");
      return 0;
    }
    await applySetupPlan(plan, resolved.commandRunner, (value) =>
      resolved.output.write(value),
    );
    resolved.output.write(
      `${command.type === "setup" ? "Setup" : "Update"} complete.\n`,
    );
    return 0;
  } catch (error) {
    resolved.error.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
