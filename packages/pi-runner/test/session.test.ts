import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  acquireSessionLease,
  defaultStateFile,
  legacyStateFile,
  listSessions,
  removeSession,
  selectedStateFile,
  sessionLeaseFile,
  validateSessionName,
} from "../src/session.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("maps canonical projects and names to isolated state files", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const other = await temporaryDirectory("kstack-project-");
  const alias = join(root, "project-alias");
  await symlink(project, alias);

  expect(defaultStateFile(project, "checkout", root)).toBe(
    defaultStateFile(alias, "checkout", root),
  );
  expect(defaultStateFile(project, "checkout", root)).not.toBe(
    defaultStateFile(project, "review", root),
  );
  expect(defaultStateFile(project, "checkout", root)).not.toBe(
    defaultStateFile(other, "checkout", root),
  );
});

test("rejects names that could escape or ambiguously address a session", () => {
  expect(validateSessionName("checkout-api")).toBe("checkout-api");

  for (const name of ["../escape", "UPPER", ".", "ends-", "has space", ""]) {
    expect(() => validateSessionName(name)).toThrow("Session names must");
  }
});

test("uses and lists a legacy default without forking it", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const legacy = legacyStateFile(project, root);
  await mkdir(join(root, "kriscard-stack"), { recursive: true });
  await writeFile(legacy, "legacy conversation");

  expect(selectedStateFile(project, "default", root)).toBe(legacy);
  await expect(listSessions(project, root)).resolves.toMatchObject([
    { name: "default", path: legacy, legacy: true },
  ]);
  await expect(readFile(legacy, "utf8")).resolves.toBe("legacy conversation");
});

test("finds a canonical legacy default through a project symlink", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await realpath(await temporaryDirectory("kstack-project-"));
  const alias = join(root, "project-alias");
  const legacy = legacyStateFile(project, root);
  await symlink(project, alias);
  await mkdir(join(root, "kriscard-stack"), { recursive: true });
  await writeFile(legacy, "legacy conversation");

  expect(selectedStateFile(alias, "default", root)).toBe(legacy);
});

test("rejects ambiguous legacy defaults across project aliases", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await realpath(await temporaryDirectory("kstack-project-"));
  const alias = join(root, "project-alias");
  await symlink(project, alias);
  await mkdir(join(root, "kriscard-stack"), { recursive: true });
  await Promise.all([
    writeFile(legacyStateFile(project, root), "canonical legacy"),
    writeFile(legacyStateFile(alias, root), "alias legacy"),
  ]);

  expect(() => selectedStateFile(alias, "default", root)).toThrow(
    "Multiple legacy default sessions",
  );
});

test("does not reclaim an unreadable session lease", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });
  const lease = sessionLeaseFile(selected);
  await writeFile(lease, "not a sqlite database");

  await expect(acquireSessionLease(selected)).rejects.toThrow(
    "Session lease cannot be opened safely",
  );
  await expect(readFile(lease, "utf8")).resolves.toBe("not a sqlite database");
});

test("keeps lease artifacts outside the session namespace", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });

  const release = await acquireSessionLease(selected);
  await release();
  await expect(listSessions(project, root)).resolves.toEqual([]);
  expect(sessionLeaseFile(selected)).not.toBe(
    defaultStateFile(project, "checkout.sqlite.lease", root),
  );
  await expect(removeSession(project, "checkout.sqlite.lease", root)).rejects.toThrow(
    "does not exist",
  );
  await expect(readFile(sessionLeaseFile(selected))).resolves.toBeInstanceOf(Buffer);

  await writeFile(selected, "conversation");
  await expect(listSessions(project, root)).resolves.toMatchObject([
    { name: "checkout", path: selected, legacy: false },
  ]);
});

test("prevents concurrent use and removal of an open session", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });
  await writeFile(selected, "db");

  const release = await acquireSessionLease(selected);
  await expect(acquireSessionLease(selected)).rejects.toThrow(
    "Session is already open or being removed",
  );
  await expect(removeSession(project, "checkout", root)).rejects.toThrow(
    "Session is already open or being removed",
  );
  await release();

  const releaseAgain = await acquireSessionLease(selected);
  await releaseAgain();
});

test("grants one lease across concurrent acquisition attempts", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => acquireSessionLease(selected)),
  );

  const acquired = attempts.filter(
    (attempt): attempt is PromiseFulfilledResult<() => Promise<void>> =>
      attempt.status === "fulfilled",
  );

  expect(acquired).toHaveLength(1);
  expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(19);
  await acquired[0].value();
});

test("recovers the session lease after its owner crashes", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });

  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { DatabaseSync } from "node:sqlite";
const database = new DatabaseSync(process.env.LEASE_PATH, { timeout: 0 });
database.exec("BEGIN EXCLUSIVE");
process.stdout.write("ready\\n");
setInterval(() => {}, 1_000);`,
    ],
    {
      env: { ...process.env, LEASE_PATH: sessionLeaseFile(selected) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await once(child.stdout, "data");
  await expect(acquireSessionLease(selected)).rejects.toThrow(
    "Session is already open or being removed",
  );
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;

  const release = await acquireSessionLease(selected);
  await release();
});

test("removes only the selected database and its sidecars", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  const sibling = defaultStateFile(project, "review", root);
  await mkdir(join(selected, ".."), { recursive: true });
  await Promise.all([
    writeFile(selected, "db"),
    writeFile(`${selected}-wal`, "wal"),
    writeFile(`${selected}-shm`, "shm"),
    writeFile(sibling, "keep"),
  ]);

  await expect(removeSession(project, "checkout", root)).resolves.toHaveLength(3);
  await expect(readFile(sibling, "utf8")).resolves.toBe("keep");
  await expect(readFile(selected)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(sessionLeaseFile(selected))).resolves.toBeInstanceOf(Buffer);

  await writeFile(selected, "new conversation");
  const release = await acquireSessionLease(selected);
  await release();
});
