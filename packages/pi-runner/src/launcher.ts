import { existsSync } from "node:fs";
import { homedir, constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const KRISCARD_MODE_DIRECTIVE =
  "Kriscard mode is enabled. Before handling each user request, read and follow the kriscard-mode skill, select exactly one matching playbook, state the selected playbook, and then follow it.";

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
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const localModePath = resolve(moduleDirectory, "../../../skills/dev/kriscard-mode");
  const bundledModePath = resolve(moduleDirectory, "skills/kriscard-mode");

  const candidates = [
    process.env.KSTACK_MODE_PATH,
    localModePath,
    join(homedir(), ".agents", "skills", "kriscard-mode"),
    join(piAgentDirectory(), "skills", "kriscard-mode"),
    bundledModePath,
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

export function buildPiArguments(options: BuildPiArgumentsOptions): string[] {
  const arguments_ = [
    "--skill",
    options.modePath,
    "--append-system-prompt",
    KRISCARD_MODE_DIRECTIVE,
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
