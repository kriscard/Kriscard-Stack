import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { SetupError } from "./errors.js";

export async function readExisting(file: string): Promise<string | undefined> {
  try {
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024)
        throw new SetupError(
          "Setup configuration must be a small regular file with no hard links",
        );
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

export function jsonRecord(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SetupError(
      "Existing configuration is invalid JSON; repair it before setup",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new SetupError("Existing setup configuration must be a JSON object");
  return parsed as Record<string, unknown>;
}
