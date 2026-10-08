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
          "Setup configuration must be a small regular file with no hard links; inspect the target and reviewed backup before replacing it with a private regular file",
        );
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") return undefined;
      if (error.code === "ELOOP" || error.code === "EMLINK")
        throw new SetupError(
          "Configuration file is a symlink; provide its explicit Stow package with --stow-source, or review the link and choose a regular private destination",
        );
      if (error.code === "EACCES" || error.code === "EPERM")
        throw new SetupError(
          "Configuration cannot be read with current permissions; review ownership and private access before retrying",
        );
      if (error.code === "ENOTDIR")
        throw new SetupError(
          "Configuration parent is not a directory; inspect the supplied home or Stow package and choose the correct root",
        );
    }
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
