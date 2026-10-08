import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { acquireOwnerLock } from "../src/runtime/ownership.js";

function isLockConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ALREADY_RUNNING"
  );
}

test("one process owns the control-plane lock and release permits a new owner", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-owner-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireOwnerLock(root);
  t.onTestFinished(() => owner.release());

  assert.equal(
    (await stat(path.join(root, ".owner.lock"))).mode & 0o777,
    0o600,
  );
  await assert.rejects(acquireOwnerLock(root), isLockConflict);
  await owner.release();
  const nextOwner = await acquireOwnerLock(root);
  await nextOwner.release();
});

test("an existing shared lock file is rejected without changing its permissions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-owner-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireOwnerLock(root);
  await owner.release();
  const lockPath = path.join(root, ".owner.lock");
  await chmod(lockPath, 0o644);

  await assert.rejects(acquireOwnerLock(root), /must be private/);
  assert.equal((await stat(lockPath)).mode & 0o777, 0o644);
});

test("a killed owner releases the OS lock for a replacement process", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-owner-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const lockPath = path.join(root, ".owner.lock");
  const script = `
    const {openSync,constants}=require('node:fs');
    const {spawnSync}=require('node:child_process');
    const fd=openSync(process.argv[1],constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    const result=spawnSync('/usr/bin/lockf',['-s','-t','0','3'],{stdio:['ignore','pipe','pipe',fd]});
    if(result.status!==0)process.exit(result.status??1);
    process.stdout.write('ready');
    process.stdin.resume();
  `;
  const holder = spawn(process.execPath, ["-e", script, lockPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.onTestFinished(() => {
    holder.kill("SIGKILL");
  });
  if (!holder.stdout) throw new Error("Expected the lock holder's stdout");

  const [ready] = await once(holder.stdout, "data");
  assert.equal(ready.toString(), "ready");
  await assert.rejects(acquireOwnerLock(root), isLockConflict);
  const exited = once(holder, "exit");
  holder.kill("SIGKILL");
  await exited;

  const recovered = await acquireOwnerLock(root);
  await recovered.release();
  assert.equal((await readFile(lockPath)).byteLength, 0);
});
