import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
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

import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  defineDoc,
  defineExtension,
  defineTask,
  Harness,
  createRegistry,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, expectTypeOf, test } from "vitest";

import {
  acquireTaskFiles,
  inspectTaskFilesystem,
  supportsTaskFilesystem,
} from "../../src/durable/task-files.js";
import { DurableTaskHost } from "../../src/durable/task-host.js";
import {
  ConversationIdentityDoc,
  TaskMetadataDoc,
  type ConversationBinding,
} from "../../src/durable/task-state.js";

const context = BACKGROUND_CONTEXT;

const fixture = fileURLToPath(new URL("./fixtures/task-owner.mjs", import.meta.url));

async function inFixture(
  check: (directory: string, repository: string, stateDir: string) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "kstack-task-ownership-"));
  const repository = join(directory, "repository");
  const stateDir = join(directory, "state");
  mkdirSync(repository);

  try {
    await check(directory, repository, stateDir);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withOwner(
  operation: "start" | "seed" | "default-start",
  stateDir: string,
  repository: string,
  marker: string,
  check: (owner: ChildProcessWithoutNullStreams, taskId: string) => Promise<void>,
) {
  const owner = spawn(process.execPath, [fixture, operation, stateDir, repository, marker], {
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: join(stateDir, "test-home"),
      XDG_STATE_HOME: join(stateDir, "xdg"),
    },
  });

  const reader = createInterface({ input: owner.stdout });
  const exited = once(owner, "exit");
  const deadline = setTimeout(() => owner.kill("SIGKILL"), 8_000);

  try {
    const first = await reader[Symbol.asyncIterator]().next();
    expect(first.value).toMatch(/^ready /);

    if (!first.value?.startsWith("ready ")) throw new Error("Owner did not acknowledge startup");
    await check(owner, first.value.slice(6));
  } finally {
    owner.stdin.end();
    await exited;
    clearTimeout(deadline);
    reader.close();
  }
}

const Marker = defineTask<{ path: string }, { phase: "write" }, null>({
  name: "kstack.ownership-marker",
  version: 1,
  initial: () => ({ phase: "write" }),
  phases: {
    write: async (task, runtime, ctx) => {
      writeFileSync(task.input.path, "executed");
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        ctx,
      );
    },
  },
  abort: (_task, runtime, ctx) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

const markerExtension = defineExtension({ name: "ownership-test", tasks: [Marker] });

test("new tasks persist private metadata and distinct conversation/provider bindings", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const options = { repositoryRoot, stateDir, models: createModels() };
    const first = await DurableTaskHost.start(options, context);
    let identities: readonly ConversationBinding[] | undefined;

    try {
      await first.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
      const root = await first.harness.conversation(ROOT_CONVERSATION_ID, context);

      if (!root) throw new Error("Expected task root");

      const entry = await first.harness.commit(
        (tx) => tx.appendEntry(ROOT_CONVERSATION_ID, { kind: "kstack.identity-test" }),
        context,
      );

      await root.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
      const view = await first.inspect(context);
      identities = view.identities;
      expectTypeOf(view.identities).toEqualTypeOf<readonly ConversationBinding[]>();
      expect(view.metadata.repositoryRoot).toBe(realpathSync(repositoryRoot));
      expect(view.metadata.taskId).toBe(first.taskId);
      expect(view.identities).toHaveLength(3);
      expect(new Set(view.identities.map((identity) => identity.providerSessionId)).size).toBe(3);
      expect(view.identities[0]?.role).toBe("main");
      expect(view.identities[1]?.role).toBe("unassigned");
      expect(view.identities[2]?.role).toBe("unassigned");
      expect(view.identities[0]?.providerSessionId).not.toBe(view.identities[1]?.providerSessionId);
      expect(view.inspection.scheduling).toBe("paused");
      expect(statSync(first.directory).mode & 0o777).toBe(0o700);
      expect(statSync(join(first.directory, "owner.lock")).mode & 0o777).toBe(0o600);
      expect(statSync(join(first.directory, "session.sqlite")).mode & 0o777).toBe(0o600);
    } finally {
      await first.close(context);
    }

    const second = await DurableTaskHost.reopen({ ...options, taskId: first.taskId }, context);

    try {
      expect((await second.inspect(context)).identities).toEqual(identities);
      expect((await second.inspect(context)).inspection.scheduling).toBe("paused");
    } finally {
      await Promise.all([second.close(context), second.close(context)]);
    }
  });
});

test("a competing process is rejected before touching or recreating a missing database", async () => {
  await inFixture(async (_directory, repository, stateDir) => {
    await withOwner("start", stateDir, repository, "", async (_owner, taskId) => {
      const database = join(stateDir, taskId, "session.sqlite");
      const retained = `${database}.retained`;
      renameSync(database, retained);

      try {
        const contender = spawnSync(process.execPath, [fixture, "probe", stateDir, taskId], {
          encoding: "utf8",
          timeout: 3_000,
        });

        expect(contender.status).toBe(2);
        expect(contender.stdout).toContain("Task already has a live owner");
        expect(existsSync(database)).toBe(false);
      } finally {
        renameSync(retained, database);
      }
    });
  });
});

test("SIGKILL recovery preserves committed state and inspection does not execute pending tasks", async () => {
  await inFixture(async (directory, repository, stateDir) => {
    const marker = join(directory, "must-not-run-on-inspection");
    let taskId = "";

    await withOwner("seed", stateDir, repository, marker, async (owner, id) => {
      taskId = id;
      const killed = once(owner, "exit");
      owner.kill("SIGKILL");
      await killed;
    });

    const host = await DurableTaskHost.reopen(
      { stateDir, taskId, models: createModels(), extensions: [markerExtension] },
      context,
    );

    try {
      let commits = 0;

      const unsubscribe = host.harness.subscribeCommits(() => {
        commits += 1;
      });

      const view = await host.inspect(context);
      await host.inspect(context);
      unsubscribe();
      expect(commits).toBe(0);
      expect(view.inspection.scheduling).toBe("paused");
      expect(view.inspection.tasks).toHaveLength(1);
      expect(existsSync(marker)).toBe(false);
      const root = await host.harness.conversation(ROOT_CONVERSATION_ID, context);

      if (!root) throw new Error("Recovered root is missing");
      const entries = await root.entries({}, 20, undefined, context);
      expect(entries.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "kstack.ownership-acknowledgement",
            data: { text: "committed before kill" },
          }),
        ]),
      );

      const pending = view.inspection.tasks[0];

      if (!pending) throw new Error("Expected a pending marker task");
      host.harness.resume();
      await host.harness.waitForTask(pending.record.id, context);
      expect(readFileSync(marker, "utf8")).toBe("executed");
    } finally {
      await host.close(context);
    }
  });
});

test("reopen never creates a missing task or a replacement root conversation", async () => {
  await inFixture(async (_directory, _repository, stateDir) => {
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: "missing", models: createModels() }, context),
    ).rejects.toThrow();
    expect(existsSync(stateDir)).toBe(false);
    const files = await acquireTaskFiles("rootless", stateDir, "start", context);

    const harness = await Harness.open(
      await openNodeSqliteStorage(files.database),
      { models: createModels(), registry: createRegistry() },
      context,
    );

    await harness.close(context);
    files.release();
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: "rootless", models: createModels() }, context),
    ).rejects.toThrow("root conversation is missing");

    const check = await Harness.open(
      await openNodeSqliteStorage(files.database),
      { models: createModels(), registry: createRegistry() },
      context,
    );

    try {
      expect(await check.conversation(ROOT_CONVERSATION_ID, context)).toBeUndefined();
    } finally {
      await check.close(context);
    }
  });
});

test("an unsupported task format fails closed and does not leak the ownership lock", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    const future = defineDoc({
      kind: TaskMetadataDoc.definition.kind,
      version: 1,
      scope: "session",
      initial: () => ({ record: { formatVersion: 2 } }),
      checkpointWhen: () => true,
    });

    await host.harness.commit(async (tx) => {
      (await tx.doc(future)).record.formatVersion = 2;
    }, context);
    await host.close(context);
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow("metadata does not match");
    const files = await acquireTaskFiles(host.taskId, stateDir, "resume", context);
    files.release();
  });
});

test("corrupt provider bindings are refused rather than silently regenerated", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    await host.harness.commit(async (tx) => {
      (await tx.doc(ConversationIdentityDoc, ROOT_CONVERSATION_ID)).providerSessionId = "wrong";
    }, context);
    await host.close(context);
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow("identity binding");
  });
});

test("a missing or replaced repository blocks reopening without finding another checkout", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    await host.close(context);
    renameSync(repositoryRoot, `${repositoryRoot}.retained`);
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow();
    mkdirSync(repositoryRoot);
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow("repository identity changed");
  });
});

test.each(["session.sqlite", "owner.lock"])(
  "hard-linked %s is refused before work",
  async (name) => {
    await inFixture(async (directory, repositoryRoot, stateDir) => {
      const host = await DurableTaskHost.start(
        { repositoryRoot, stateDir, models: createModels() },
        context,
      );

      await host.close(context);
      const duplicate = join(directory, "linked-file");
      linkSync(join(host.directory, name), duplicate);
      await expect(
        DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
      ).rejects.toThrow("hard links");
      unlinkSync(duplicate);

      const recovered = await DurableTaskHost.reopen(
        { stateDir, taskId: host.taskId, models: createModels() },
        context,
      );

      await recovered.close(context);
    });
  },
);

test.each(["session.sqlite", "owner.lock", "session.sqlite-wal", "session.sqlite-shm"])(
  "symbolic %s cannot redirect task I/O",
  async (name) => {
    await inFixture(async (directory, repositoryRoot, stateDir) => {
      const host = await DurableTaskHost.start(
        { repositoryRoot, stateDir, models: createModels() },
        context,
      );

      await host.close(context);
      const path = join(host.directory, name);

      if (existsSync(path)) renameSync(path, `${path}.retained`);
      const target = join(directory, "untouched-target");
      symlinkSync(target, path);
      await expect(
        DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
      ).rejects.toThrow();
      expect(existsSync(target)).toBe(false);
    });
  },
);

test("replacing a lock inode is not a supported ownership recovery shortcut", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    await host.close(context);
    const path = join(host.directory, "owner.lock");
    renameSync(path, `${path}.retained`);
    writeFileSync(path, "", { mode: 0o600 });
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow("lock identity");
  });
});

test("symbolic task directories and public state permissions are not admitted", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    await host.close(context);
    renameSync(host.directory, `${host.directory}.retained`);
    symlinkSync(`${host.directory}.retained`, host.directory, "dir");
    expect(lstatSync(host.directory).isSymbolicLink()).toBe(true);
    await expect(
      DurableTaskHost.reopen({ stateDir, taskId: host.taskId, models: createModels() }, context),
    ).rejects.toThrow("real directories");
    chmodSync(stateDir, 0o755);
    await expect(
      DurableTaskHost.start({ repositoryRoot, stateDir, models: createModels() }, context),
    ).rejects.toThrow("private");
  });
});

test("default storage honors XDG without touching the real home directory", async () => {
  await inFixture(async (_directory, repository, stateDir) => {
    await withOwner("default-start", stateDir, repository, "", async (_owner, taskId) => {
      expect(existsSync(join(stateDir, "xdg/kstack/durable", taskId, "session.sqlite"))).toBe(true);
    });
  });
});

test("startup cancelled after ownership acquisition closes storage and releases its lock", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const controller = new AbortController();

    const extension = {
      get name() {
        controller.abort(new Error("cancelled after lock"));

        return "cancel-startup";
      },
    };

    const cancelled = withAbortSignal(controller.signal, context);
    await expect(
      DurableTaskHost.start(
        { repositoryRoot, stateDir, models: createModels(), extensions: [extension] },
        cancelled,
      ),
    ).rejects.toThrow("cancelled after lock");
    const [taskId] = readdirSync(stateDir);

    if (!taskId) throw new Error("Expected retained initialization state");
    const files = await acquireTaskFiles(taskId, stateDir, "resume", context);
    files.release();
  });
});

test("already-cancelled startup creates no task state", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const cancelled = withAbortSignal(AbortSignal.abort(new Error("cancelled startup")), context);
    await expect(
      DurableTaskHost.start({ repositoryRoot, stateDir, models: createModels() }, cancelled),
    ).rejects.toThrow("cancelled startup");
    expect(existsSync(stateDir)).toBe(false);
  });
});

test("filesystem inspection honors original cancellation and deadlines on real local storage", async () => {
  const controller = new AbortController();
  controller.abort(new Error("filesystem inspection cancelled"));
  await expect(
    inspectTaskFilesystem(tmpdir(), { signal: controller.signal, deadline: Date.now() + 1000 }),
  ).rejects.toThrow("filesystem inspection cancelled");

  const signal = new AbortController().signal;
  await expect(
    inspectTaskFilesystem(tmpdir(), { signal, deadline: Date.now() - 1 }),
  ).rejects.toThrow("Filesystem inspection deadline expired");

  const type = await inspectTaskFilesystem(tmpdir(), { signal, deadline: Date.now() + 1000 });
  expect(supportsTaskFilesystem(process.platform, type)).toBe(true);
});

test("Darwin filesystem admission uses the verified APFS name, not its numeric type", () => {
  expect(supportsTaskFilesystem("darwin", "apfs")).toBe(true);
  expect(supportsTaskFilesystem("darwin", 25)).toBe(false);
  expect(supportsTaskFilesystem("darwin", 26)).toBe(false);
  expect(supportsTaskFilesystem("darwin", "nfs")).toBe(false);
  expect(supportsTaskFilesystem("darwin", "smbfs")).toBe(false);
  expect(supportsTaskFilesystem("darwin", "unknown")).toBe(false);
});

test("network, ambiguous and unsupported platform filesystems are rejected", () => {
  expect(supportsTaskFilesystem("linux", 0xef53)).toBe(true);
  expect(supportsTaskFilesystem("darwin", 26)).toBe(false);
  expect(supportsTaskFilesystem("linux", 0x6969)).toBe(false);
  expect(supportsTaskFilesystem("linux", 0x65735546)).toBe(false);
  expect(supportsTaskFilesystem("linux", 0)).toBe(false);
  expect(supportsTaskFilesystem("win32", 26)).toBe(false);
});

test("failed extension registration releases ownership even before storage opens", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const broken = {
      get name(): string {
        throw new Error("extension install failed");
      },
    };

    await expect(
      DurableTaskHost.start(
        { repositoryRoot, stateDir, models: createModels(), extensions: [broken] },
        context,
      ),
    ).rejects.toThrow("extension install failed");
    const [taskId] = readdirSync(stateDir);

    if (!taskId) throw new Error("Expected retained initialization state");
    await expect(acquireTaskFiles(taskId, stateDir, "resume", context)).rejects.toThrow("empty");
  });
});

test("a cancelled close wait does not abandon mandatory cleanup or ownership release", async () => {
  await inFixture(async (_directory, repositoryRoot, stateDir) => {
    const host = await DurableTaskHost.start(
      { repositoryRoot, stateDir, models: createModels() },
      context,
    );

    try {
      const cancelled = withAbortSignal(AbortSignal.abort(new Error("stop waiting")), context);
      await expect(host.close(cancelled)).rejects.toThrow("stop waiting");
      await host.harness.closed;
      await expect
        .poll(
          async () => {
            try {
              const next = await DurableTaskHost.reopen(
                { stateDir, taskId: host.taskId, models: createModels() },
                context,
              );

              await next.close(context);

              return true;
            } catch (error) {
              if (error instanceof Error && error.message === "Task already has a live owner")
                return false;
              throw error;
            }
          },
          { timeout: 500, interval: 20 },
        )
        .toBe(true);
    } finally {
      await host.close(context);
    }
  });
});
