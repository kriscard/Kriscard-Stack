import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { GitBinding } from "./workspace-git.js";
import type { OperatorProof } from "./workspace-release.js";

import { gitExecutionControl, type GitExecutionControl } from "./git-execution.js";
import { inspectTaskFilesystem, supportsTaskFilesystem } from "./task-files.js";

export function privateDirectory(path: string) {
  const info = lstatSync(path);

  if (
    !info.isDirectory() ||
    realpathSync(path) !== path ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Ownership state requires canonical private directories");
  }
}

function privateFile(descriptor: number) {
  const info = fstatSync(descriptor);

  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Ownership records/locks require private single-link regular files");
  }
}

export async function lockPrivateFile(path: string, create: boolean) {
  privateDirectory(dirname(path));
  const { flockSync } = await import("fs-ext");

  const descriptor = openSync(
    path,
    constants.O_RDWR | constants.O_NOFOLLOW | (create ? constants.O_CREAT : 0),
    0o600,
  );

  let closed = false;

  const release = () => {
    if (closed) return;
    closeSync(descriptor);
    closed = true;
  };

  try {
    privateFile(descriptor);
    const info = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(path, { bigint: true });

    if (info.dev !== named.dev || info.ino !== named.ino)
      throw new Error("Ownership lock identity changed");

    try {
      flockSync(descriptor, "exnb");
    } catch (error) {
      throw new Error("Ownership lock is unavailable; a live owner cannot be bypassed", {
        cause: error,
      });
    }

    return { device: info.dev.toString(), inode: info.ino.toString(), release };
  } catch (error) {
    release();
    throw error;
  }
}

export type ClaimLock = Awaited<ReturnType<typeof lockPrivateFile>> & { directory: string };

export async function acquireAdmissionGate(
  commonDirectory: string,
  control: GitExecutionControl = gitExecutionControl(),
) {
  if (
    !supportsTaskFilesystem(process.platform, await inspectTaskFilesystem(commonDirectory, control))
  )
    throw new Error("Worktree claims require supported local storage");
  const directory = join(commonDirectory, "kstack-durable");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateDirectory(directory);

  // Serialize creation/admission, not writers: nonexistent case aliases cannot bypass claims.
  return lockPrivateFile(join(directory, "admission.lock"), true);
}

export async function acquireClaim(
  commonDirectory: string,
  worktree: string,
  create: boolean,
  control: GitExecutionControl = gitExecutionControl(),
): Promise<ClaimLock> {
  if (
    !supportsTaskFilesystem(process.platform, await inspectTaskFilesystem(commonDirectory, control))
  ) {
    throw new Error("Worktree claims require supported local storage");
  }

  let directory = commonDirectory;

  for (const part of [
    "kstack-durable",
    "claims",
    createHash("sha256").update(worktree).digest("hex"),
  ]) {
    directory = join(directory, part);

    if (create) mkdirSync(directory, { mode: 0o700, recursive: true });
    privateDirectory(directory);
  }

  return { ...(await lockPrivateFile(join(directory, "owner.lock"), create)), directory };
}

function readPrivateText(path: string) {
  if (!lstatSync(path, { throwIfNoEntry: false })) return undefined;
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    privateFile(descriptor);

    if (fstatSync(descriptor).size > 64 * 1024) throw new Error("Ownership record is too large");

    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export type ReleaseTombstone = {
  formatVersion: 1;
  releaseId: string;
  kind: "assignment" | "operator-unavailable-store";
  reservation: Reservation;
  proof: OperatorProof & { observedBinding: GitBinding; processTableHash: string };
  observedAt: number;
  outcome?: string;
};

export function writeRecord(path: string, value: Reservation | ReleaseTombstone) {
  privateDirectory(dirname(path));
  readPrivateText(path);
  const content = JSON.stringify(value);

  if (Buffer.byteLength(content) > 64 * 1024) throw new Error("Ownership record is too large");
  const temporary = join(dirname(path), `.record-${randomUUID()}`);

  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );

  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  renameSync(temporary, path);
  const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);

  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export type Reservation = {
  formatVersion: 1;
  taskId: string;
  assignmentId: string;
  taskDirectory: string;
  worktree: string;
  lockDevice: string;
  lockInode: string;
  releaseId: string | null;
};

type ClaimReference = Pick<ClaimLock, "directory" | "device" | "inode">;

function readReservationRecord(claim: ClaimReference, worktree?: string): Reservation | undefined {
  const text = readPrivateText(join(claim.directory, "reservation.json"));

  if (text === undefined) return undefined;

  try {
    const value: Reservation = JSON.parse(text);
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.deepEqual(Object.keys(value).sort(), [
      "assignmentId",
      "formatVersion",
      "lockDevice",
      "lockInode",
      "releaseId",
      "taskDirectory",
      "taskId",
      "worktree",
    ]);
    assert.equal(value.formatVersion, 1);
    assert.match(value.taskId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    assert.match(value.assignmentId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    assert.equal(isAbsolute(value.taskDirectory), true);
    assert.equal(basename(value.taskDirectory), value.taskId);
    assert.equal(
      join(realpathSync(dirname(value.taskDirectory)), value.taskId),
      value.taskDirectory,
    );
    assert.equal(isAbsolute(value.worktree), true);
    assert.equal(join(value.worktree), value.worktree);
    assert.equal(
      basename(claim.directory),
      createHash("sha256").update(value.worktree).digest("hex"),
    );

    if (worktree !== undefined) assert.equal(value.worktree, worktree);
    assert.equal(value.lockDevice, claim.device);
    assert.equal(value.lockInode, claim.inode);

    if (value.releaseId !== null) {
      assert.match(
        value.releaseId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const tombstone = readPrivateText(join(claim.directory, `release-${value.releaseId}.json`));
      assert.ok(tombstone, "Released ownership requires a retained release tombstone");
      const release: ReleaseTombstone = JSON.parse(tombstone);
      assert.equal(Object.getPrototypeOf(release), Object.prototype);
      assert.equal(release.formatVersion, 1);
      assert.equal(release.releaseId, value.releaseId);
      assert.ok(["assignment", "operator-unavailable-store"].includes(release.kind));
      assert.deepEqual(release.reservation, { ...value, releaseId: null });
      assert.equal(Number.isSafeInteger(release.observedAt) && release.observedAt > 0, true);
      assert.match(release.proof.inspectionId, /^[0-9a-f]{64}$/);
      assert.match(release.proof.authority, /\S/);
      assert.match(release.proof.activityEvidence, /\S/);
      assert.match(release.proof.effectEvidence, /\S/);
      assert.equal(release.proof.quiescent, true);
      assert.equal(release.proof.observedBinding.worktree, value.worktree);
      assert.match(release.proof.processTableHash, /^[0-9a-f]{64}$/);

      if (release.kind === "operator-unavailable-store")
        assert.equal(
          release.outcome,
          "Ownership released only; original task outcome remains uncertified",
        );
    }

    return value;
  } catch (cause) {
    throw new Error("Missing/inconsistent worktree reservation or release receipt", { cause });
  }
}

export function readReservation(claim: ClaimLock, worktree: string): Reservation | undefined {
  return readReservationRecord(claim, worktree);
}

// Caller holds the common admission gate. Reading stable lock identity does not
// acquire another task's lock: live and dead-owner reservations both exclude overlap.
export function unreleasedReservations(commonDirectory: string): Reservation[] {
  const root = join(commonDirectory, "kstack-durable", "claims");

  if (!lstatSync(root, { throwIfNoEntry: false })) return [];
  privateDirectory(root);
  const reservations: Reservation[] = [];

  for (const name of readdirSync(root)) {
    assert.match(name, /^[0-9a-f]{64}$/);
    const directory = join(root, name);
    privateDirectory(directory);
    const path = join(directory, "owner.lock");

    if (!lstatSync(path, { throwIfNoEntry: false })) {
      // acquireClaim can die after mkdir and before lock creation. No Git effect
      // precedes reservation.json; an empty directory reserves nothing.
      if (lstatSync(join(directory, "reservation.json"), { throwIfNoEntry: false }))
        throw new Error("Reservation lock identity is missing");
      continue;
    }

    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      privateFile(descriptor);
      const info = fstatSync(descriptor, { bigint: true });
      const named = lstatSync(path, { bigint: true });
      assert.equal(info.dev, named.dev);
      assert.equal(info.ino, named.ino);

      const reservation = readReservationRecord({
        directory,
        device: info.dev.toString(),
        inode: info.ino.toString(),
      });

      if (reservation?.releaseId === null) reservations.push(reservation);
    } finally {
      closeSync(descriptor);
    }
  }

  return reservations;
}
