import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, expectTypeOf, test } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/lock-owner.mjs", import.meta.url));

type HolderMode = "hold" | "hold-with-child" | "hold-with-inherited-child";

async function inFixture(check: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "kstack-durable-dependencies-"));

  try {
    await check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withHolder(
  path: string,
  mode: HolderMode,
  check: (owner: ChildProcessWithoutNullStreams, lines: AsyncIterator<string>) => Promise<void>,
) {
  const owner = spawn(process.execPath, [fixture, mode, path], { stdio: "pipe" });
  const reader = createInterface({ input: owner.stdout });
  const lines = reader[Symbol.asyncIterator]();
  const exited = once(owner, "exit");
  const deadline = setTimeout(() => owner.kill("SIGKILL"), 5_000);

  try {
    expect((await lines.next()).value).toBe("held");
    await check(owner, lines);
  } finally {
    owner.stdin.end();
    await exited;
    clearTimeout(deadline);
    reader.close();
  }
}

function probe(path: string) {
  const result = spawnSync(process.execPath, [fixture, "probe", path], {
    encoding: "utf8",
    timeout: 3_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();

  return { status: result.status, output: result.stdout.trim(), error: result.stderr };
}

test("the published coding-agent model runtime loads and satisfies the Harness models contract", async () => {
  expectTypeOf<ModelRuntime>().toMatchTypeOf<Models>();
  await expect(import("@earendil-works/pi-coding-agent")).resolves.toHaveProperty(
    "ModelRuntime.create",
  );
});

test("the published Durable SQLite adapter preserves a committed entry across reopen", async () => {
  await inFixture(async (directory) => {
    const path = join(directory, "session.sqlite");
    const options = { models: createModels(), registry: createRegistry() };

    const first = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      BACKGROUND_CONTEXT,
    );

    try {
      const root = await first.root(BACKGROUND_CONTEXT);
      await root.submit(
        {
          type: "write",
          requestId: "dependency-entry",
          entry: { kind: "kstack.dependency-test", data: { text: "persisted before reopen" } },
        },
        BACKGROUND_CONTEXT,
      );
    } finally {
      await first.close(BACKGROUND_CONTEXT);
    }

    const second = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      BACKGROUND_CONTEXT,
    );

    try {
      const root = await second.root(BACKGROUND_CONTEXT);
      const entries = await root.entries({ order: "ascending" }, 20, undefined, BACKGROUND_CONTEXT);
      expect(entries.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "kstack.dependency-test",
            data: { text: "persisted before reopen" },
          }),
        ]),
      );
    } finally {
      await second.close(BACKGROUND_CONTEXT);
    }
  });
});

test("a live process excludes a competing lock owner without replacing the lock inode", async () => {
  await inFixture(async (directory) => {
    const path = join(directory, "owner.lock");
    let inode = 0;

    await withHolder(path, "hold", async () => {
      inode = statSync(path).ino;
      expect(probe(path)).toEqual({ status: 2, output: "blocked", error: "" });
      expect(statSync(path).ino).toBe(inode);
    });

    expect(probe(path)).toEqual({ status: 0, output: "acquired", error: "" });
    expect(statSync(path).ino).toBe(inode);
  });
});

test("SIGKILL releases kernel ownership without application cleanup or a stale lease", async () => {
  await inFixture(async (directory) => {
    const path = join(directory, "owner.lock");

    await withHolder(path, "hold", async (owner) => {
      const inode = statSync(path).ino;
      const killed = once(owner, "exit");
      owner.kill("SIGKILL");
      await killed;
      expect(probe(path)).toEqual({ status: 0, output: "acquired", error: "" });
      expect(statSync(path).ino).toBe(inode);
    });
  });
});

test("a live spawned descendant does not inherit a lock descriptor by default", async () => {
  await inFixture(async (directory) => {
    const path = join(directory, "owner.lock");

    await withHolder(path, "hold-with-child", async (owner, lines) => {
      owner.stdin.write("close-lock\n");
      expect((await lines.next()).value).toBe("descendant-alive");
      expect(probe(path)).toEqual({ status: 0, output: "acquired", error: "" });
    });
  });
});

test("the inheritance control detects a descriptor deliberately passed to a live descendant", async () => {
  await inFixture(async (directory) => {
    const path = join(directory, "owner.lock");

    await withHolder(path, "hold-with-inherited-child", async (owner, lines) => {
      owner.stdin.write("close-lock\n");
      expect((await lines.next()).value).toBe("descendant-alive");
      expect(probe(path)).toEqual({ status: 2, output: "blocked", error: "" });
    });

    expect(probe(path)).toEqual({ status: 0, output: "acquired", error: "" });
  });
});
