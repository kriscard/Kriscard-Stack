import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc } from "@earendil-works/pi-durable";

import { openControlPlane } from "../src/runtime/open.js";

const Counter = defineDoc<{ count: number }>({
  kind: "kriscard.test-counter",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
});

test("the only owner persists SQLite state and releases ownership on close", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-runtime-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const originalUmask = process.umask();
  const runtime = await openControlPlane(root);
  t.onTestFinished(() => runtime.close());
  assert.equal(process.umask(), 0o077);
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(Counter)).count++;
  }, BACKGROUND_CONTEXT);

  await assert.rejects(
    openControlPlane(root),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ALREADY_RUNNING",
  );
  const otherRoot = await mkdtemp(
    path.join(tmpdir(), "kriscard-runtime-other-"),
  );
  t.onTestFinished(() => rm(otherRoot, { recursive: true, force: true }));
  await assert.rejects(
    openControlPlane(otherRoot),
    /already open in this process/,
  );
  for (const file of await readdir(root)) {
    if (file.startsWith("state.sqlite")) {
      assert.equal((await stat(path.join(root, file))).mode & 0o777, 0o600);
    }
  }
  await runtime.close();
  assert.equal(process.umask(), originalUmask);

  const recovered = await openControlPlane(root);
  assert.deepEqual(
    await recovered.harness.snapshot(Counter, BACKGROUND_CONTEXT),
    {
      count: 1,
    },
  );
  await recovered.close();
});

test("existing shared SQLite files and symlinked databases are rejected", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-runtime-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const database = path.join(root, "state.sqlite");
  await writeFile(database, "");
  await chmod(database, 0o644);
  await assert.rejects(openControlPlane(root), /private regular file/);
  assert.equal((await stat(database)).mode & 0o777, 0o644);

  await rm(database);
  const outside = path.join(root, "outside.sqlite");
  await writeFile(outside, "must survive");
  await symlink(outside, database);
  await assert.rejects(openControlPlane(root), /private regular file/);
  assert.equal(await stat(outside).then((info) => info.size), 12);
});
