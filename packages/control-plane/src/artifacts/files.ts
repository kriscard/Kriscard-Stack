import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

import type * as z from "zod";

import { ArtifactStoreError } from "./errors.js";
import { privateFileMode, readFileWithoutFollowingSymlinks } from "./paths.js";

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(filePath: string): Promise<{
  sha256: string;
  size: number;
}> {
  const content = await readFileWithoutFollowingSymlinks(filePath);
  return { sha256: sha256(content), size: content.byteLength };
}

export async function writePrivateFileAtomic(
  destination: string,
  content: Uint8Array | string,
): Promise<void> {
  const parent = path.dirname(destination);
  const temporary = path.join(
    parent,
    `.${path.basename(destination)}.kriscard-tmp`,
  );
  await rm(temporary, { force: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", privateFileMode);
    await handle.chmod(privateFileMode);
    await handle.writeFile(content);
    await handle.sync();
    const completedHandle = handle;
    handle = undefined;
    await completedHandle.close();
    await rename(temporary, destination);
    await syncDirectory(parent);
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    await syncDirectory(parent);
    throw error;
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writePrivateJson(
  destination: string,
  value: unknown,
): Promise<void> {
  await writePrivateFileAtomic(
    destination,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function readParsedJson<Schema extends z.ZodType>(
  filePath: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const content = await readFileWithoutFollowingSymlinks(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT",
      `Invalid JSON artifact: ${filePath}`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`)
      .join("; ");
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT",
      `Invalid artifact record ${filePath}: ${details}`,
    );
  }
  return result.data;
}
