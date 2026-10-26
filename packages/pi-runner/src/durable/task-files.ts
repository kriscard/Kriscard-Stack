import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statfsSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Context } from "@earendil-works/chord";

import { gitExecutionControl, type GitExecutionControl } from "./git-execution.js";
import { requireTaskId } from "./inputs.js";
import { ProcessExecutionError, runProcess } from "./process-execution.js";

// Linux magic.h: ext, XFS, Btrfs, tmpfs, overlay.
const linuxFilesystems = new Set<number | string>([
  0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630,
]);

export function supportsTaskFilesystem(platform: string, type: number | string) {
  if (platform === "darwin") return type === "apfs";

  return platform === "linux" && linuxFilesystems.has(type);
}

export async function inspectTaskFilesystem(root: string, control: GitExecutionControl) {
  control.signal.throwIfAborted();
  const remaining = control.deadline - Date.now();

  if (!Number.isFinite(control.deadline) || remaining <= 0)
    throw new Error("Filesystem inspection deadline expired");

  if (process.platform !== "darwin") return statfsSync(root).type;

  // Darwin's numeric filesystem type can vary across hosts; verify the OS name.
  const result = await runProcess(
    "/bin/df",
    ["-P", "-T", "apfs", root],
    root,
    { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    Math.min(1000, remaining),
    control.signal,
  );

  if (result.reason !== "exited" || !result.quiescent)
    throw new ProcessExecutionError(result, "Task filesystem inspection");

  return result.exitCode === 0 &&
    result.stdoutValidUtf8 &&
    result.stdout.trim().split("\n").length >= 2
    ? "apfs"
    : "unknown";
}

function requirePrivateOwner(info: Stats) {
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw new Error("Task state must be private to the current user");
  }
}

function requirePrivateDirectory(path: string) {
  const info = lstatSync(path);

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Task state requires real directories, not symbolic links");
  }

  requirePrivateOwner(info);
}

function requirePrivateFile(info: Stats) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error("Task files must be regular single-link files, not symbolic or hard links");
  }

  requirePrivateOwner(info);
}

export function checkSqliteFiles(directory: string, requireDatabase: boolean) {
  for (const name of ["session.sqlite", "session.sqlite-wal", "session.sqlite-shm"]) {
    const info = lstatSync(join(directory, name), { throwIfNoEntry: false });

    if (!info) {
      if (name === "session.sqlite" && requireDatabase) throw new Error("Task database is missing");
      continue;
    }

    requirePrivateFile(info);

    if (name === "session.sqlite" && requireDatabase && info.size === 0) {
      throw new Error("Task database is empty or initialization was interrupted");
    }
  }
}

export type TaskFiles = {
  readonly taskId: string;
  readonly directory: string;
  readonly database: string;
  readonly lockDevice: string;
  readonly lockInode: string;
  release(): void;
};

export async function acquireTaskFiles(
  taskId: string,
  stateDir: string | undefined,
  operation: "start" | "resume",
  context: Context,
): Promise<TaskFiles> {
  requireTaskId(taskId);
  context.abortSignal?.throwIfAborted();
  const control = gitExecutionControl(context.abortSignal);

  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("Durable task ownership requires local macOS or Linux storage");
  }

  const { flockSync } = await import("fs-ext");
  context.abortSignal?.throwIfAborted();

  const rootInput =
    stateDir ??
    join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "kstack/durable");

  if (!isAbsolute(rootInput)) throw new Error("Task state root must be absolute");

  if (operation === "start") mkdirSync(rootInput, { recursive: true, mode: 0o700 });

  const root = realpathSync(rootInput);
  requirePrivateDirectory(root);

  if (!supportsTaskFilesystem(process.platform, await inspectTaskFilesystem(root, control))) {
    throw new Error(
      "Unsupported task filesystem; network/shared or unknown storage is not admitted",
    );
  }

  const directory = join(root, taskId);

  if (operation === "start") mkdirSync(directory, { mode: 0o700 });
  requirePrivateDirectory(directory);

  const lockPath = join(directory, "owner.lock");
  const createFlags = operation === "start" ? constants.O_CREAT | constants.O_EXCL : 0;

  const descriptor = openSync(
    lockPath,
    constants.O_RDWR | constants.O_NOFOLLOW | createFlags,
    0o600,
  );

  let released = false;

  const release = () => {
    if (released) return;
    closeSync(descriptor);
    released = true;
  };

  try {
    const opened = fstatSync(descriptor);
    requirePrivateFile(opened);
    const identity = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(lockPath, { bigint: true });

    if (identity.dev !== named.dev || identity.ino !== named.ino) {
      throw new Error("Task lock identity changed while opening");
    }

    try {
      flockSync(descriptor, "exnb");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")
      ) {
        throw new Error("Task already has a live owner", { cause: error });
      }

      throw error;
    }

    checkSqliteFiles(directory, operation === "resume");
    const database = join(directory, "session.sqlite");

    if (operation === "start") {
      const file = openSync(
        database,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );

      closeSync(file);
    }

    return {
      taskId,
      directory,
      database,
      lockDevice: identity.dev.toString(),
      lockInode: identity.ino.toString(),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
