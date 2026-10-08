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
import { openControlPlane } from "../src/runtime/open.js";
import { waitForCommand } from "./wait-for-command.js";

test("the only owner persists SQLite state and releases ownership on close", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-runtime-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const originalUmask = process.umask();
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "persisted-reference";
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  t.onTestFinished(() => runtime.close());
  assert.equal("harness" in runtime, false);
  assert.equal(process.umask(), 0o077);
  const input = { key: "persisted", operation: "probe" };
  const taskId = await runtime.submit(input);
  await waitForCommand(runtime, input.key, "completed");

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

  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  assert.equal(await recovered.submit(input), taskId);
  assert.equal(
    (await recovered.command(input.key))?.receipt?.reference,
    "persisted-reference",
  );
  await recovered.close();
});

test("submission validation rejects through the returned promise", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-runtime-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const withoutAdapter = await openControlPlane(root);
  try {
    const submission = withoutAdapter.submit({
      key: "missing",
      operation: "probe",
    });
    await assert.rejects(submission, /No command adapter is configured/);
  } finally {
    await withoutAdapter.close();
  }

  const withAdapter = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => undefined,
    async execute() {
      return "unreachable";
    },
  });
  try {
    const submission = withAdapter.submit({
      key: "unsupported",
      operation: "probe",
    });
    await assert.rejects(submission, /Unsupported command operation/);
  } finally {
    await withAdapter.close();
  }
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
