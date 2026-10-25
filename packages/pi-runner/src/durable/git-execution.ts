import {
  ProcessExecutionError,
  runProcess,
  type ProcessExecutionResult,
} from "./process-execution.js";

// This is a host-only boundary, not a tool: callers own the fixed operation and
// argv. Paths are passed separately so Git never interprets them as pathspecs.
export type GitExecution = {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly paths?: readonly string[];
  readonly deadline: number;
  readonly signal: AbortSignal;
};

export class GitExecutionError extends ProcessExecutionError {
  constructor(outcome: ProcessExecutionResult) {
    super(outcome, "Git");
    this.name = "GitExecutionError";
  }
}

export async function executeGit(request: GitExecution): Promise<string> {
  const { cwd, deadline, signal } = request;
  const argv = [...request.argv];
  const paths = request.paths ? [...request.paths] : [];
  signal.throwIfAborted();
  const remaining = deadline - Date.now();

  if (!Number.isFinite(deadline) || remaining <= 0) throw new Error("Git deadline expired");

  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  const outcome = await runProcess(
    "git",
    [
      "--no-optional-locks",
      "--literal-pathspecs",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...argv,
      ...(paths.length ? ["--", ...paths] : []),
    ],
    cwd,
    {
      ...environment,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
    },
    Math.min(120_000, remaining),
    signal,
  );

  if (outcome.reason !== "exited" || outcome.exitCode !== 0 || !outcome.quiescent)
    throw new GitExecutionError(outcome);

  return outcome.stdout;
}

export type GitExecutionControl = Pick<GitExecution, "deadline" | "signal">;

// One control is captured per host operation, never renewed between Git calls.
export function gitExecutionControl(signal = new AbortController().signal): GitExecutionControl {
  return { signal, deadline: Date.now() + 120_000 };
}
