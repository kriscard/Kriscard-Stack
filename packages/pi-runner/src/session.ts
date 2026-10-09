import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { open, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

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
  return join(
    projectStateDirectory(cwd, root),
    `${validateSessionName(session)}.sqlite`,
  );
}

export function legacyStateFile(cwd: string, root = dataRoot()): string {
  return join(root, "kriscard-stack", `${projectHash(resolve(cwd))}.sqlite`);
}

export function selectedStateFile(
  cwd: string,
  session = DEFAULT_SESSION,
  root = dataRoot(),
): string {
  const current = defaultStateFile(cwd, session, root);
  if (session !== DEFAULT_SESSION || existsSync(current)) return current;

  const legacy = legacyStateFile(cwd, root);
  return existsSync(legacy) ? legacy : current;
}

export function sessionExists(
  cwd: string,
  session: string,
  root = dataRoot(),
): boolean {
  return existsSync(selectedStateFile(cwd, session, root));
}

export async function listSessions(
  cwd: string,
  root = dataRoot(),
): Promise<SessionInfo[]> {
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
      sessions.push({
        name,
        path,
        legacy: false,
        modifiedAt: (await stat(path)).mtime,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const legacy = legacyStateFile(cwd, root);
  if (
    existsSync(legacy) &&
    !sessions.some((session) => session.name === DEFAULT_SESSION)
  ) {
    sessions.push({
      name: DEFAULT_SESSION,
      path: legacy,
      legacy: true,
      modifiedAt: (await stat(legacy)).mtime,
    });
  }

  return sessions.sort((left, right) => left.name.localeCompare(right.name));
}

function lockFile(stateFile: string): string {
  return `${stateFile}.lock`;
}

async function activeLock(stateFile: string): Promise<number | undefined> {
  const path = lockFile(stateFile);
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid)) {
      return undefined;
    }
    try {
      process.kill(value.pid, 0);
      return value.pid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return value.pid;
      return undefined;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

export async function acquireSessionLock(
  stateFile: string,
): Promise<() => Promise<void>> {
  const path = lockFile(stateFile);
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, token, startedAt: new Date() }),
        );
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await readFile(path, "utf8")) as {
            token?: unknown;
          };
          if (current.token === token) await rm(path, { force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = await activeLock(stateFile);
      if (pid !== undefined) {
        throw new Error(`Session is already open by process ${pid}`);
      }
      await rm(path, { force: true });
    }
  }
  throw new Error("Could not acquire the session lock");
}

export async function removeSession(
  cwd: string,
  session: string,
  root = dataRoot(),
): Promise<string[]> {
  const path = selectedStateFile(cwd, validateSessionName(session), root);
  if (!existsSync(path)) throw new Error(`Session '${session}' does not exist`);
  const pid = await activeLock(path);
  if (pid !== undefined) {
    throw new Error(`Session '${session}' is open by process ${pid}`);
  }
  await rm(lockFile(path), { force: true });

  const paths = [path, `${path}-shm`, `${path}-wal`];
  const removed: string[] = [];
  for (const candidate of paths) {
    if (!existsSync(candidate)) continue;
    await rm(candidate, { force: true });
    removed.push(candidate);
  }
  return removed;
}
