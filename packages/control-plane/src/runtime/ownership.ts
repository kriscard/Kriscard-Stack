import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import {
  canonicalizePotentialPath,
  ensurePrivateDirectory,
} from "../artifacts/paths.js";

export type OwnerLockErrorCode = "ALREADY_RUNNING" | "LOCK_FAILURE";
export type OwnerLockError = Error & { readonly code: OwnerLockErrorCode };

function lockError(code: OwnerLockErrorCode, message: string): OwnerLockError {
  return Object.assign(new Error(message), { name: "OwnerLockError", code });
}

/** Keep the returned file handle open until the Pi Durable Harness is closed. */
export async function acquireOwnerLock(dataRoot: string) {
  if (process.platform !== "darwin") {
    throw lockError(
      "LOCK_FAILURE",
      "The control plane currently requires macOS",
    );
  }

  const root = canonicalizePotentialPath(dataRoot);
  await ensurePrivateDirectory(root);
  const lockPath = path.join(root, ".owner.lock");
  const handle = await open(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );

  try {
    if (((await handle.stat()).mode & 0o777) !== 0o600) {
      throw lockError(
        "LOCK_FAILURE",
        `Owner lock must be private: ${lockPath}`,
      );
    }

    // lockf locks the inherited descriptor. This process keeps that descriptor
    // open, so the kernel releases the lock if this process dies.
    const attempt = spawnSync("/usr/bin/lockf", ["-s", "-t", "0", "3"], {
      stdio: ["ignore", "pipe", "pipe", handle.fd],
    });
    if (attempt.status === 75) {
      throw lockError("ALREADY_RUNNING", `Control plane already owns ${root}`);
    }
    if (attempt.error || attempt.status !== 0) {
      throw lockError(
        "LOCK_FAILURE",
        `Could not lock ${lockPath}: ${attempt.error?.message ?? attempt.stderr.toString("utf8")}`,
      );
    }
  } catch (error) {
    await handle.close();
    throw error;
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      await handle.close();
    },
  };
}
