import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, test } from "vitest";

import { DurableTaskHost } from "../../src/durable/task-host.js";
import { acquireClaim } from "../../src/durable/workspace-claims.js";
import { inspectGit } from "../../src/durable/workspace-git.js";
import {
  releaseStrandedWorktree,
  type ConfirmInspection,
} from "../../src/durable/workspace-release.js";
import { WorkspacesDoc, type AssignmentApproval } from "../../src/durable/workspace-state.js";

const context = BACKGROUND_CONTEXT;

const authority = "Explicit operator approval for disposable fixture worktrees";

const confirm: ConfirmInspection = async (inspection) => ({
  inspectionId: inspection.inspectionId,
  authority,
  activityEvidence:
    "Inspected real process table and controlled fixture children; all target commands have exited",
  effectEvidence: "Inspected current Git branch/head/status and retained fixture source files",
  quiescent: inspection.matchingProcesses.length === 0,
});

function command(directory: string, args: string[]) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...environment, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

async function fixture(
  check: (
    root: string,
    repository: string,
    start: () => Promise<DurableTaskHost>,
    approval: (id: string) => AssignmentApproval,
  ) => Promise<void>,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kstack-workspaces-")));
  const repository = join(root, "repository");
  mkdirSync(repository);
  command(repository, ["init", "-b", "main"]);
  writeFileSync(join(repository, "file.txt"), "original\n");
  command(repository, ["add", "file.txt"]);
  command(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const base = command(repository, ["rev-parse", "HEAD"]);
  const hosts: DurableTaskHost[] = [];

  const start = async () => {
    const host = await DurableTaskHost.start(
      { repositoryRoot: repository, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    hosts.push(host);

    return host;
  };

  const approval = (id: string): AssignmentApproval => ({
    kind: "create",
    id,
    worktree: join(root, id),
    branch: `feature/${id}`,
    base,
    writePaths: ["file.txt"],
    contextHashes: [],
  });

  try {
    await check(root, repository, start, approval);
  } finally {
    for (const host of hosts) await host.close(context);
    rmSync(root, { recursive: true, force: true });
  }
}

async function assignment(host: DurableTaskHost, id: string) {
  const state = await host.harness.snapshot(WorkspacesDoc, context);
  const record = state?.assignments.find((entry) => entry.id === id);

  if (!record) throw new Error("Expected an assignment receipt");

  return record;
}

function existing(approval: AssignmentApproval): AssignmentApproval {
  return { ...approval, kind: "existing", binding: inspectGit(approval.worktree) };
}

test("two exclusive worktrees are journaled without changing the caller's dirty checkout", async () => {
  await fixture(async (_root, repository, start, approval) => {
    writeFileSync(join(repository, "file.txt"), "user dirty edit\n");
    writeFileSync(join(repository, "untracked.txt"), "preserve this\n");
    const before = command(repository, ["status", "--porcelain=v1"]);
    const host = await start();
    await host.workspaces.admit(
      inspectGit(repository),
      [approval("alpha"), approval("beta")],
      authority,
      context,
    );
    const state = await host.harness.snapshot(WorkspacesDoc, context);
    expect(state?.assignments.map((entry) => entry.status)).toEqual(["admitted", "admitted"]);
    expect(state?.effects.map((entry) => entry.status)).toEqual(["observed"]);

    for (const id of ["alpha", "beta"]) {
      const record = await assignment(host, id);
      expect(command(record.worktree, ["branch", "--show-current"])).toBe(`feature/${id}`);
      expect(readFileSync(join(record.worktree, "file.txt"), "utf8")).toBe("original\n");
      expect(lstatSync(record.claimDirectory).mode & 0o777).toBe(0o700);
      expect(lstatSync(join(record.claimDirectory, "owner.lock")).mode & 0o777).toBe(0o600);
    }

    expect(command(repository, ["status", "--porcelain=v1"])).toBe(before);
    expect(command(repository, ["branch", "--show-current"])).toBe("main");
    expect(readFileSync(join(repository, "file.txt"), "utf8")).toBe("user dirty edit\n");
    expect(readFileSync(join(repository, "untracked.txt"), "utf8")).toBe("preserve this\n");
  });
});

test("admission captures approval values before async work and close drains admitted operations", async () => {
  await fixture(async (root, repository, start, approval) => {
    const host = await start();
    const paths = ["file.txt"];
    const target = { ...approval("immutable"), writePaths: paths };
    const expectedWorktree = target.worktree;
    const pending = host.workspaces.admit(inspectGit(repository), [target], authority, context);
    target.worktree = join(root, "unapproved");
    paths.push("unapproved-source");
    await Promise.all([pending, host.close(context)]);
    expect(existsSync(join(expectedWorktree, "file.txt"))).toBe(true);
    expect(existsSync(target.worktree)).toBe(false);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      expect((await assignment(reopened, "immutable")).writePaths).toEqual(["file.txt"]);
    } finally {
      await reopened.close(context);
    }
  });
});

test("another task cannot acquire a live claim or a reservation left after clean close", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const owner = await start();
    const competitor = await start();
    const target = approval("owned");
    await owner.workspaces.admit(inspectGit(repository), [target], authority, context);
    await expect(
      competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
    ).rejects.toThrow(/live owner/);
    await owner.close(context);
    await expect(
      competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
    ).rejects.toThrow(/unresolved assignment reservation/);
    expect(await owner.harness.closed).toEqual({ reason: "closed" });
  });
});

test("normal release retains source, branch, tombstone, and the stable claim inode", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const target = approval("retained");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    const record = await assignment(host, target.id);
    const inode = statSync(join(record.claimDirectory, "owner.lock")).ino;
    await expect(releaseStrandedWorktree(target.worktree, confirm, context)).rejects.toThrow(
      /live owner/,
    );
    await host.workspaces.release(target.id, confirm, context);
    expect(existsSync(join(target.worktree, "file.txt"))).toBe(true);
    expect(command(target.worktree, ["branch", "--show-current"])).toBe(target.branch);
    expect(
      readdirSync(record.claimDirectory).filter((name) => name.startsWith("release-")),
    ).toHaveLength(1);
    const competitor = await start();
    await competitor.workspaces.admit(
      inspectGit(repository),
      [existing(target)],
      authority,
      context,
    );
    expect(statSync(join(record.claimDirectory, "owner.lock")).ino).toBe(inode);
  });
});

test("batch contention does not partially admit the other worktree or retain its kernel claim", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const owner = await start();
    const blocked = await start();
    const fresh = await start();
    const first = approval("a-first");
    const second = approval("z-held");
    await owner.workspaces.admit(inspectGit(repository), [second], authority, context);
    await expect(
      blocked.workspaces.admit(
        inspectGit(repository),
        [first, existing(second)],
        authority,
        context,
      ),
    ).rejects.toThrow(/live owner/);
    expect(await blocked.harness.snapshot(WorkspacesDoc, context)).toBeUndefined();
    expect(existsSync(first.worktree)).toBe(false);
    await fresh.workspaces.admit(inspectGit(repository), [first], authority, context);
  });
});

test("serialized admission enforces the writer cap and refuses a different repository", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();

    await fixture(async (_otherRoot, otherRepository, _otherStart, otherApproval) => {
      const target = otherApproval("not-approved");
      await expect(
        host.workspaces.admit(inspectGit(otherRepository), [target], authority, context),
      ).rejects.toThrow(/second repository/);
      expect(existsSync(target.worktree)).toBe(false);
    });

    const source = inspectGit(repository);

    const results = await Promise.allSettled(
      ["first", "second", "third"].map((id) =>
        host.workspaces.admit(source, [approval(id)], authority, context),
      ),
    );

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect((await host.harness.snapshot(WorkspacesDoc, context))?.assignments).toHaveLength(2);
    expect(existsSync(approval("third").worktree)).toBe(false);
  });
});

test("invalid, duplicate, overlapping and excess writers fail before creating worktrees", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const first = approval("one");

    for (const entries of [
      [first, approval("two"), approval("three")],
      [first, { ...approval("two"), branch: first.branch }],
      [first, { ...approval("two"), id: first.id }],
      [{ ...first, worktree: join(repository, "..nested") }],
      [{ ...first, writePaths: [".git/config"] }],
    ])
      await expect(
        host.workspaces.admit(inspectGit(repository), entries, authority, context),
      ).rejects.toThrow();
    expect(await host.harness.snapshot(WorkspacesDoc, context)).toBeUndefined();
    expect(existsSync(first.worktree)).toBe(false);
  });
});

test("reopen reacquires matching ownership, but changed material source needs explicit reconciliation", async () => {
  await fixture(async (root, repository, start, approval) => {
    const host = await start();
    const target = approval("resume");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    await host.close(context);
    writeFileSync(join(target.worktree, "new.txt"), "an untracked material change\n");

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toMatch(/source binding changed/);
      await expect(
        reopened.workspaces.admit(inspectGit(repository), [approval("extra")], authority, context),
      ).rejects.toThrow(/source binding changed/);
      await reopened.workspaces.reconcile(confirm, context);
      expect(reopened.workspaces.blockedReason).toBeUndefined();
      expect(readFileSync(join(target.worktree, "new.txt"), "utf8")).toBe(
        "an untracked material change\n",
      );
      await reopened.workspaces.release(target.id, confirm, context);
    } finally {
      await reopened.close(context);
    }
  });
});

test("moved worktrees block admission and never cause replacement checkout creation", async () => {
  await fixture(async (root, repository, start, approval) => {
    const host = await start();
    const target = approval("moved");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    await host.close(context);
    command(repository, ["worktree", "move", target.worktree, join(root, "relocated")]);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toBeTruthy();
      await expect(reopened.workspaces.reconcile(confirm, context)).rejects.toThrow();
      expect(existsSync(target.worktree)).toBe(false);
      expect(existsSync(join(root, "relocated", "file.txt"))).toBe(true);
    } finally {
      await reopened.close(context);
    }
  });
});

test("stale external context hashes block recovery rather than silently rebinding", async () => {
  await fixture(async (root, repository, start, approval) => {
    const source = join(root, "approved-context.txt");
    writeFileSync(source, "approved context");

    const target = {
      ...approval("context"),
      contextHashes: [
        { path: source, sha256: createHash("sha256").update("approved context").digest("hex") },
      ],
    };

    const host = await start();
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    await host.close(context);
    writeFileSync(source, "changed context");

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toMatch(/context\/source hash/);
      await expect(reopened.workspaces.reconcile(confirm, context)).rejects.toThrow(
        /context\/source hash/,
      );
    } finally {
      await reopened.close(context);
    }
  });
});

test("failed Git creation retains intent/reservation and requires inspection, not automatic replay", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const target = approval("interrupted");
    const refLock = join(repository, ".git/refs/heads/feature/interrupted.lock");
    mkdirSync(join(repository, ".git/refs/heads/feature"), { recursive: true });
    writeFileSync(refLock, "simulate another Git operation");
    await expect(
      host.workspaces.admit(inspectGit(repository), [target], authority, context),
    ).rejects.toThrow();
    const record = await assignment(host, target.id);
    expect(record.status).toBe("pending");
    expect(readFileSync(join(record.claimDirectory, "reservation.json"), "utf8")).toContain(
      host.taskId,
    );
    expect((await host.harness.snapshot(WorkspacesDoc, context))?.effects[0]?.status).toBe(
      "intent",
    );
    unlinkSync(refLock);
    await expect(
      host.workspaces.admit(inspectGit(repository), [target], authority, context),
    ).rejects.toThrow(/Unresolved workspace effect/);
    command(repository, ["worktree", "add", "-b", target.branch, target.worktree, target.base]);
    await host.workspaces.reconcile(confirm, context);
    expect((await assignment(host, target.id)).status).toBe("admitted");
    expect(
      (await host.harness.snapshot(WorkspacesDoc, context))?.effects.every(
        (effect) => effect.status === "observed",
      ),
    ).toBe(true);
  });
});

test("copied workspace documents cannot transfer another task's reservation ownership", async () => {
  await fixture(async (root, repository, start, approval) => {
    const original = await start();
    await original.workspaces.admit(
      inspectGit(repository),
      [approval("bound-task")],
      authority,
      context,
    );
    const state = await original.harness.snapshot(WorkspacesDoc, context);

    if (!state?.repository) throw new Error("Expected original bindings");
    await original.close(context);
    const other = await start();
    await other.harness.commit(async (tx) => {
      const document = await tx.doc(WorkspacesDoc);
      document.repository = state.repository;
      document.assignments = state.assignments.map((record) => ({
        ...record,
        writePaths: [...record.writePaths],
        contextHashes: record.contextHashes.map((source) => ({ ...source })),
        reservation: { ...record.reservation },
        binding: record.binding ? { ...record.binding } : null,
      }));
    }, context);
    await other.close(context);

    const reopened = await DurableTaskHost.reopen(
      { taskId: other.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toMatch(/task.*binding|another task|identity/);
    } finally {
      await reopened.close(context);
    }
  });
});

test("healthy stores cannot be bypassed by administrative release", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const target = approval("healthy");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    await host.close(context);
    await expect(releaseStrandedWorktree(target.worktree, confirm, context)).rejects.toThrow(
      /store is readable/,
    );
  });
});

test("corrupt-store recovery requires authority/evidence and leaves the corrupt store untouched", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const target = approval("corrupt");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    await host.close(context);
    const database = join(host.directory, "session.sqlite");
    writeFileSync(database, "retained corrupt database");
    await expect(
      releaseStrandedWorktree(
        target.worktree,
        async (inspection) => ({ ...(await confirm(inspection)), authority: "" }),
        context,
      ),
    ).rejects.toThrow(/operator authority/);
    const released = await releaseStrandedWorktree(target.worktree, confirm, context);
    expect(readFileSync(database, "utf8")).toBe("retained corrupt database");
    expect(readFileSync(released.tombstone, "utf8")).toContain(
      "original task outcome remains uncertified",
    );
    const competitor = await start();
    await competitor.workspaces.admit(
      inspectGit(repository),
      [existing(target)],
      authority,
      context,
    );
  });
});

test("a release interrupted after its SDK receipt can be explicitly finished without losing its reservation", async () => {
  await fixture(async (root, repository, start, approval) => {
    const host = await start();
    const target = approval("release-window");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    const record = await assignment(host, target.id);
    const reservation = join(record.claimDirectory, "reservation.json");
    const extraLink = join(root, "retained-reservation-link");
    await expect(
      host.workspaces.release(
        target.id,
        async (inspection) => {
          linkSync(reservation, extraLink);

          return confirm(inspection);
        },
        context,
      ),
    ).rejects.toThrow(/single-link/);
    expect((await assignment(host, target.id)).status).toBe("released");
    unlinkSync(extraLink);
    await host.close(context);
    const competitor = await start();
    await expect(
      competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
    ).rejects.toThrow(/unresolved assignment reservation/);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
      context,
    );

    try {
      await reopened.workspaces.release(target.id, confirm, context);
    } finally {
      await reopened.close(context);
    }

    await competitor.workspaces.admit(
      inspectGit(repository),
      [existing(target)],
      authority,
      context,
    );
  });
});

test("malformed tombstones and replaced stable claim inodes cannot authorize a new writer", async () => {
  await fixture(async (_root, repository, start, approval) => {
    const host = await start();
    const target = approval("receipt");
    await host.workspaces.admit(inspectGit(repository), [target], authority, context);
    const record = await assignment(host, target.id);
    await host.workspaces.release(target.id, confirm, context);

    const tombstone = readdirSync(record.claimDirectory).find((name) =>
      name.startsWith("release-"),
    );

    if (!tombstone) throw new Error("Expected release tombstone");
    const contents = readFileSync(join(record.claimDirectory, tombstone));
    writeFileSync(join(record.claimDirectory, tombstone), "{}");
    const competitor = await start();
    await expect(
      competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
    ).rejects.toThrow(/receipt/);
    writeFileSync(join(record.claimDirectory, tombstone), contents);
    const lock = join(record.claimDirectory, "owner.lock");
    const replacement = join(record.claimDirectory, "replacement.lock");
    writeFileSync(replacement, "", { mode: 0o600 });
    unlinkSync(lock);
    linkSync(replacement, lock);
    await expect(
      competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
    ).rejects.toThrow(/single-link/);
  });
});

test("source fingerprinting refuses tracked files reached through a replaced directory link", async () => {
  await fixture(async (root, repository) => {
    mkdirSync(join(repository, "directory"));
    writeFileSync(join(repository, "directory/tracked.txt"), "tracked");
    command(repository, ["add", "."]);
    command(repository, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "nested source",
    ]);
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "tracked.txt"), "not approved source");
    rmSync(join(repository, "directory"), { recursive: true });
    symlinkSync(outside, join(repository, "directory"));
    expect(() => inspectGit(repository)).toThrow(/source.*link|symbolic|contain/i);
  });
});

async function crashOwner(
  root: string,
  repository: string,
  worktree: string,
  check: (taskId: string, kill: () => Promise<void>) => Promise<void>,
  dropClaims = false,
) {
  const script = fileURLToPath(new URL("./fixtures/workspace-owner.mjs", import.meta.url));

  const child = spawn(
    process.execPath,
    [script, root, repository, worktree, dropClaims ? "drop-claims" : "hold-claims"],
    { stdio: "pipe" },
  );

  const reader = createInterface({ input: child.stdout });
  const exited = once(child, "exit");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);

  try {
    const first = await reader[Symbol.asyncIterator]().next();

    if (!first.value?.startsWith("ready "))
      throw new Error("Fixture owner did not acknowledge admission");
    await check(first.value.slice(6), async () => {
      child.kill("SIGKILL");
      await exited;
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    clearTimeout(timeout);
    reader.close();
  }
}

test("administration also refuses a live task lock when its worktree claim is free", async () => {
  await fixture(async (root, repository, _start, approval) => {
    const target = approval("task-lock");
    await crashOwner(
      root,
      repository,
      target.worktree,
      async (taskId, kill) => {
        const claim = await acquireClaim(
          inspectGit(repository).commonDirectory,
          target.worktree,
          false,
        );

        claim.release();
        unlinkSync(join(root, "state", taskId, "session.sqlite"));
        await expect(releaseStrandedWorktree(target.worktree, confirm, context)).rejects.toThrow(
          /live owner/,
        );
        await kill();
        await releaseStrandedWorktree(target.worktree, confirm, context);
      },
      true,
    );
  });
});

test("SIGKILL frees the kernel claim but not the assignment reservation; matching task can resume", async () => {
  await fixture(async (root, repository, start, approval) => {
    const target = approval("crash");
    await crashOwner(root, repository, target.worktree, async (taskId, kill) => {
      await kill();
      const competitor = await start();
      await expect(
        competitor.workspaces.admit(inspectGit(repository), [existing(target)], authority, context),
      ).rejects.toThrow(/unresolved assignment reservation/);

      const reopened = await DurableTaskHost.reopen(
        { taskId, stateDir: join(root, "state"), models: createModels() },
        context,
      );

      try {
        expect(reopened.workspaces.blockedReason).toBeUndefined();
        await reopened.workspaces.release("crash", confirm, context);
      } finally {
        await reopened.close(context);
      }

      await competitor.workspaces.admit(
        inspectGit(repository),
        [existing(target)],
        authority,
        context,
      );
    });
  });
});

test("missing-store recovery blocks live/orphan activity and retains an explicit release tombstone", async () => {
  await fixture(async (root, repository, start, approval) => {
    const target = approval("orphan");
    await crashOwner(root, repository, target.worktree, async (taskId, kill) => {
      const database = join(root, "state", taskId, "session.sqlite");
      unlinkSync(database);
      await expect(releaseStrandedWorktree(target.worktree, confirm, context)).rejects.toThrow(
        /live owner/,
      );
      await kill();

      const orphan = spawn(
        process.execPath,
        [
          "-e",
          "const fs=require('fs'); fs.appendFileSync(process.argv[1]+'/file.txt','orphan write\\n'); console.log('ready'); setInterval(()=>{},1000)",
          target.worktree,
        ],
        { stdio: "pipe" },
      );

      const reader = createInterface({ input: orphan.stdout });
      const exited = once(orphan, "exit");

      try {
        await reader[Symbol.asyncIterator]().next();
        await expect(releaseStrandedWorktree(target.worktree, confirm, context)).rejects.toThrow(
          /quiescence/,
        );
      } finally {
        orphan.kill("SIGKILL");
        await exited;
        reader.close();
      }

      await expect(
        releaseStrandedWorktree(
          target.worktree,
          async (inspection) => ({ ...(await confirm(inspection)), quiescent: false }),
          context,
        ),
      ).rejects.toThrow(/quiescence/);
      const released = await releaseStrandedWorktree(target.worktree, confirm, context);
      expect(existsSync(database)).toBe(false);
      expect(readFileSync(released.tombstone, "utf8")).toContain(taskId);
      expect(readFileSync(join(target.worktree, "file.txt"), "utf8")).toContain("orphan write");
      const competitor = await start();
      await competitor.workspaces.admit(
        inspectGit(repository),
        [existing(target)],
        authority,
        context,
      );
    });
  });
});
