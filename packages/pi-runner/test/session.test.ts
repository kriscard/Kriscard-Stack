import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  acquireSessionLock,
  defaultStateFile,
  legacyStateFile,
  listSessions,
  removeSession,
  selectedStateFile,
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

test("prevents concurrent use and removal of an open session", async () => {
  const root = await temporaryDirectory("kstack-data-");
  const project = await temporaryDirectory("kstack-project-");
  const selected = defaultStateFile(project, "checkout", root);
  await mkdir(join(selected, ".."), { recursive: true });
  await writeFile(selected, "db");

  const release = await acquireSessionLock(selected);
  await expect(acquireSessionLock(selected)).rejects.toThrow(
    `Session is already open by process ${process.pid}`,
  );
  await expect(removeSession(project, "checkout", root)).rejects.toThrow(
    `Session 'checkout' is open by process ${process.pid}`,
  );
  await release();

  const releaseAgain = await acquireSessionLock(selected);
  await releaseAgain();
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

  await expect(removeSession(project, "checkout", root)).resolves.toHaveLength(
    3,
  );
  await expect(readFile(sibling, "utf8")).resolves.toBe("keep");
  await expect(readFile(selected)).rejects.toMatchObject({ code: "ENOENT" });
});
