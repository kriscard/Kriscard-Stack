import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_SESSION = "default";

const SESSION_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export type SessionInfo = {
  name: string;
  path: string;
  legacy: boolean;
  modifiedAt: Date;
};

export function dataRoot(): string {
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}

export function canonicalProjectPath(cwd: string): string {
  const absolute = resolve(cwd);

  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function projectHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

export function validateSessionName(name: string): string {
  if (!SESSION_NAME.test(name)) {
    throw new Error(
      "Session names must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens, and must start and end with a letter or number",
    );
  }

  return name;
}

export function projectStateDirectory(cwd: string, root = dataRoot()): string {
  return join(root, "kriscard-stack", projectHash(canonicalProjectPath(cwd)));
}

export function defaultStateFile(
  cwd: string,
  session = DEFAULT_SESSION,
  root = dataRoot(),
): string {
  return join(projectStateDirectory(cwd, root), `${validateSessionName(session)}.sqlite`);
}

export function legacyStateFile(cwd: string, root = dataRoot()): string {
  return join(root, "kriscard-stack", `${projectHash(resolve(cwd))}.sqlite`);
}

function legacyStateFiles(cwd: string, root: string): string[] {
  const paths = [
    legacyStateFile(cwd, root),
    join(root, "kriscard-stack", `${projectHash(canonicalProjectPath(cwd))}.sqlite`),
  ];

  return [...new Set(paths)];
}

export function selectedStateFile(
  cwd: string,
  session = DEFAULT_SESSION,
  root = dataRoot(),
): string {
  const current = defaultStateFile(cwd, session, root);

  if (session !== DEFAULT_SESSION || existsSync(current)) return current;

  const legacy = legacyStateFiles(cwd, root).filter((path) => existsSync(path));

  if (legacy.length > 1) {
    throw new Error(`Multiple legacy default sessions match this project:\n${legacy.join("\n")}`);
  }

  return legacy[0] ?? current;
}

export async function listSessions(cwd: string, root = dataRoot()): Promise<SessionInfo[]> {
  const directory = projectStateDirectory(cwd, root);
  const sessions: SessionInfo[] = [];

  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
      const name = basename(entry.name, ".sqlite");

      try {
        validateSessionName(name);
      } catch {
        continue;
      }

      const path = join(directory, entry.name);

      try {
        sessions.push({
          name,
          path,
          legacy: false,
          modifiedAt: (await stat(path)).mtime,
        });
      } catch (error) {
        // SAFETY: Node filesystem failures expose `code` through ErrnoException.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch (error) {
    // SAFETY: Node filesystem failures expose `code` through ErrnoException.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const selectedDefault = selectedStateFile(cwd, DEFAULT_SESSION, root);

  if (
    existsSync(selectedDefault) &&
    dirname(selectedDefault) !== directory &&
    !sessions.some((session) => session.name === DEFAULT_SESSION)
  ) {
    try {
      sessions.push({
        name: DEFAULT_SESSION,
        path: selectedDefault,
        legacy: true,
        modifiedAt: (await stat(selectedDefault)).mtime,
      });
    } catch (error) {
      // SAFETY: Node filesystem failures expose `code` through ErrnoException.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return sessions.sort((left, right) => left.name.localeCompare(right.name));
}

export function sessionLeaseFile(stateFile: string): string {
  return `${stateFile}.lease`;
}

export async function acquireSessionLease(stateFile: string): Promise<() => Promise<void>> {
  const leaseFile = sessionLeaseFile(stateFile);
  let database: DatabaseSync | undefined;

  try {
    database = new DatabaseSync(leaseFile, { timeout: 0 });
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the acquisition failure.
    }

    if (
      error instanceof Error &&
      "errcode" in error &&
      (error.errcode === 5 || error.errcode === 6)
    ) {
      throw new Error("Session is already open or being removed", {
        cause: error,
      });
    }

    throw new Error(`Session lease cannot be opened safely: ${leaseFile}`, {
      cause: error,
    });
  }

  let released = false;

  return async () => {
    if (released) return;
    released = true;

    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}

export async function removeSession(
  cwd: string,
  session: string,
  root = dataRoot(),
): Promise<string[]> {
  const path = selectedStateFile(cwd, validateSessionName(session), root);

  if (!existsSync(path)) throw new Error(`Session '${session}' does not exist`);
  const release = await acquireSessionLease(path);

  try {
    if (!existsSync(path)) throw new Error(`Session '${session}' does not exist`);

    const paths = [path, `${path}-shm`, `${path}-wal`];
    const removed: string[] = [];

    for (const candidate of paths) {
      if (!existsSync(candidate)) continue;
      await rm(candidate, { force: true });
      removed.push(candidate);
    }

    return removed;
  } finally {
    await release();
  }
}
