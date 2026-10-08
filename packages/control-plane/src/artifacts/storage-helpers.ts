import { lstat } from "node:fs/promises";
import path from "node:path";

import { artifactStoreError } from "./errors.js";
import { ensurePrivateDirectory } from "./paths.js";
import type { StoredFile } from "./schemas.js";

export function assertExpectedHash(
  actual: { sha256: string; size: number },
  expected: StoredFile,
  fileName: string,
): void {
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw artifactStoreError(
      "HASH_MISMATCH",
      `Artifact hash or size changed: ${fileName}`,
    );
  }
}

export async function ensurePrivateDirectoryForFile(
  root: string,
  relativeFile: string,
): Promise<void> {
  const parent = path.posix.dirname(relativeFile);
  if (parent === ".") return;
  await ensurePrivateDirectory(root, parent);
}

export async function ensurePrivateDirectoryForRelativeDirectory(
  root: string,
  relativeDirectory: string,
): Promise<void> {
  const parent = path.posix.dirname(relativeDirectory);
  if (parent === ".") return;
  await ensurePrivateDirectory(root, parent);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
