import { existsSync } from "node:fs";
import { homedir, constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

const localModePath = resolve(moduleDirectory, "../../../skills/dev/kriscard-mode");

const bundledModePath = resolve(moduleDirectory, "skills/kriscard-mode");

export const KRISCARD_MODE_DIRECTIVE =
  "Kriscard mode is enabled. Before handling user requests, read and follow the kriscard-mode skill.";

type BuildPiArgumentsOptions = {
  arguments: readonly string[];
  modePath: string;
  model?: string;
  print?: boolean;
};

export type PiRunner = (arguments_: readonly string[], cwd: string) => Promise<number>;

function expandHome(path: string): string {
  if (path === "~") return homedir();

  if (path.startsWith("~/")) return join(homedir(), path.slice(2));

  return resolve(path);
}

function piAgentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;

  return configured ? expandHome(configured) : join(homedir(), ".pi", "agent");
}

export function resolveKriscardModePath(): string {
  const candidates = [
    process.env.KSTACK_MODE_PATH,
    localModePath,
    bundledModePath,
    join(homedir(), ".agents", "skills", "kriscard-mode"),
    join(piAgentDirectory(), "skills", "kriscard-mode"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "SKILL.md"))) return candidate;
  }

  throw new Error("The kriscard-mode skill is not installed. Run 'kstack setup' first.");
}

export function parseConfiguredModel(value: string): string[] {
  const separator = value.indexOf(":");

  if (separator < 1 || separator === value.length - 1) {
    throw new Error("KRISCARD_MODEL must use <provider>:<model-id>");
  }

  return ["--provider", value.slice(0, separator), "--model", value.slice(separator + 1)];
}

export function resolveKriscardSkillPackage(modePath: string): string | undefined {
  if (modePath === localModePath) return resolve(moduleDirectory, "../../..");

  if (modePath === bundledModePath) return resolve(moduleDirectory, "..");

  return undefined;
}

export function buildPiArguments(options: BuildPiArgumentsOptions): string[] {
  const durableCommand = [
    process.execPath,
    join(dirname(fileURLToPath(import.meta.url)), "bin.js"),
    "durable",
  ]
    .map((argument) => JSON.stringify(argument))
    .join(" ");

  const modeDirectory = expandHome(options.modePath);

  const instructions = `${KRISCARD_MODE_DIRECTIVE}
Kriscard Mode directory: ${modeDirectory} (base for its relative links).
You are in the interactive Pi frontend.
Pi Durable backend command: ${durableCommand}`;

  const skillPackage = resolveKriscardSkillPackage(options.modePath);

  // Pi loads explicit package skills before automatically discovered skills.
  const skillArguments = skillPackage
    ? ["--extension", skillPackage]
    : ["--skill", options.modePath];

  const arguments_ = [
    ...skillArguments,
    "--append-system-prompt",
    instructions,
    "--append-system-prompt",
    join(modeDirectory, "SKILL.md"),
  ];

  if (options.model) arguments_.push(...parseConfiguredModel(options.model));

  if (options.print) arguments_.push("--print");

  arguments_.push(...options.arguments);

  return arguments_;
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;

  return 128 + osConstants.signals[signal];
}

export const runNativePi: PiRunner = async (arguments_, cwd) => {
  const executable = process.env.KSTACK_PI_BIN ?? "pi";

  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, [...arguments_], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      // SAFETY: Node child-process failures expose `code` through ErrnoException.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        rejectResult(new Error(`Pi executable not found: ${executable}`));

        return;
      }

      rejectResult(error);
    });
    child.once("exit", (code, signal) => {
      resolveResult(code ?? signalExitCode(signal));
    });
  });
};
