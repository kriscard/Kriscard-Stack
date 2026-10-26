import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";

export type ProcessExecutionResult = {
  pid: number | null;
  exitCode: number | null;
  reason: "exited" | "cancelled" | "timeout" | "output-limit" | "descendants" | "spawn-error";
  output: string;
  stdout: string;
  stdoutValidUtf8: boolean;
  stderr: string;
  outputBytes: number;
  quiescent: boolean;
};

export class ProcessExecutionError extends Error {
  constructor(
    readonly outcome: ProcessExecutionResult,
    operation: string,
  ) {
    super(
      `${operation} ${outcome.reason} (pid ${outcome.pid ?? "none"}; exit ${outcome.exitCode ?? "none"}; ${outcome.quiescent ? "quiescent" : "activity unresolved"}): ${outcome.stderr}`,
    );
    this.name = "ProcessExecutionError";
  }
}

export function processGroupExists(pid: number) {
  try {
    process.kill(-pid, 0);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;

    return true;
  }
}

// Approved repository code is trusted, not an OS sandbox. Owned descendants must
// remain in this detached group; deliberately daemonizing hostile code is unsupported.
export async function runProcess(
  executable: string,
  argv: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ProcessExecutionResult> {
  signal.throwIfAborted();

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    throw new Error("Process timeout must be within the remaining 120 second command limit");

  const child = spawn(executable, [...argv], {
    cwd,
    env: environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output: Buffer[] = [];
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let retained = 0;
  let reason: ProcessExecutionResult["reason"] = "exited";
  let exitCode: number | null = null;
  let exited = false;
  let closed = false;
  let stoppingAt: number | undefined;
  let killedAt: number | undefined;
  let observer: (() => void) | undefined;
  const wake = () => observer?.();

  const waitForObservation = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);

        if (observer === done) observer = undefined;
        resolve();
      };

      const timer = setTimeout(done, 20);
      observer = done;
    });

  function send(signal: NodeJS.Signals) {
    if (!child.pid) return;

    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return;
    }
  }

  function stop(why: ProcessExecutionResult["reason"]) {
    if (stoppingAt !== undefined) return;
    reason = why;
    stoppingAt = Date.now();
    send("SIGTERM");
    wake();
  }

  function collect(chunk: Buffer, stream: Buffer[]) {
    const remaining = 1024 * 1024 - retained;

    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      output.push(part);
      stream.push(part);
      retained += part.length;
    }

    if (chunk.length > remaining) stop("output-limit");
  }

  child.stdout.on("data", (chunk: Buffer) => collect(chunk, stdout));
  child.stderr.on("data", (chunk: Buffer) => collect(chunk, stderr));
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
    wake();
  });
  child.once("close", () => {
    closed = true;
    wake();
  });
  child.once("error", () => {
    exited = true;
    reason = "spawn-error";
    wake();
  });
  const abort = () => stop("cancelled");
  signal.addEventListener("abort", abort, { once: true });

  if (signal.aborted) abort();
  const timeout = setTimeout(() => stop("timeout"), timeoutMs);
  let quiescent = false;

  try {
    for (;;) {
      const alive = child.pid ? processGroupExists(child.pid) : !exited;

      if (exited && closed && !alive) {
        quiescent = true;
        break;
      }

      if (exited && alive && stoppingAt === undefined) stop("descendants");

      if (stoppingAt !== undefined && killedAt === undefined && Date.now() - stoppingAt >= 5000) {
        send("SIGKILL");
        killedAt = Date.now();
      }

      if (killedAt !== undefined && Date.now() - killedAt >= 5000) break;
      // Exit/stream/cancel events wake immediately. Poll only to observe groups
      // with no remaining parent event; ordinary short Git calls have no 20ms floor.
      await waitForObservation();
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    // Stop output delivery only after group observation; never infer termination
    // from root exit, stream closure or cancellation of the caller's wait.
    child.stdout.destroy();
    child.stderr.destroy();
  }

  function text(chunks: readonly Buffer[]) {
    let value = Buffer.concat(chunks).toString("utf8");

    // Replacement characters for split/invalid UTF-8 can expand the retained bytes.
    while (Buffer.byteLength(value) > 1024 * 1024)
      value = Buffer.from(value)
        .subarray(0, 1024 * 1024 - 3)
        .toString("utf8");

    return value;
  }

  return {
    pid: child.pid ?? null,
    exitCode,
    reason,
    output: text(output),
    stdout: text(stdout),
    stdoutValidUtf8: isUtf8(Buffer.concat(stdout)),
    stderr: text(stderr),
    outputBytes: retained,
    quiescent,
  };
}
