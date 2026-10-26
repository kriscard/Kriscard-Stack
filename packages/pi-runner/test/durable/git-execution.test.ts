import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  readlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, test } from "vitest";

import {
  executeGit,
  GitExecutionError,
  gitExecutionControl,
} from "../../src/durable/git-execution.js";
import { processGroupExists } from "../../src/durable/process-execution.js";
import { DurableTaskHost } from "../../src/durable/task-host.js";
import { acquireClaim } from "../../src/durable/workspace-claims.js";
import { WorkspacesDoc, verifyContextHashes } from "../../src/durable/workspace-state.js";
import { inspectGit, requireSameGit } from "../../src/durable/workspace-git.js";
import { inspectGit as inspectLegacyGit } from "./fixtures/legacy-workspace-git.js";

function setupGit(cwd: string, argv: string[]) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...argv],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
}

async function fixture(check: (root: string, cwd: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kstack-git-execution-")));
  const cwd = join(root, "repository");
  mkdirSync(cwd);
  setupGit(cwd, ["init", "-b", "main"]);
  writeFileSync(join(cwd, "file.txt"), "original\n");
  setupGit(cwd, ["add", "file.txt"]);
  setupGit(cwd, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);

  try {
    await check(root, cwd);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Git path scopes are literal, including wildcard, bracket and pathspec-magic filenames", async () => {
  await fixture(async (_root, cwd) => {
    for (const name of ["new*.txt", "new-private.txt", "[file]?.txt", ":(glob)*.txt"])
      writeFileSync(join(cwd, name), "untracked\n");

    for (const name of ["new*.txt", "[file]?.txt", ":(glob)*.txt"]) {
      const control = gitExecutionControl();
      expect(
        await executeGit({
          cwd,
          argv: ["ls-files", "--others", "--exclude-standard", "-z"],
          paths: [name],
          ...control,
        }),
      ).toBe(`${name}\0`);
      expect(
        await executeGit({
          cwd,
          argv: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          paths: [name],
          ...control,
        }),
      ).toBe(`?? ${name}\0`);
    }
  });
});

test("async source/index fingerprints preserve the original binding bytes and reject a restored worktree over a changed index", async () => {
  await fixture(async (_root, cwd) => {
    const original = await inspectGit(cwd);
    expect(original).toEqual(inspectLegacyGit(cwd));
    writeFileSync(join(cwd, "file.txt"), "staged change\n");
    setupGit(cwd, ["add", "file.txt"]);
    writeFileSync(join(cwd, "file.txt"), "original\n");
    const staged = await inspectGit(cwd);
    expect(staged).toEqual(inspectLegacyGit(cwd));
    expect(staged.sourceHash).not.toBe(original.sourceHash);
    await expect(requireSameGit(original)).rejects.toThrow("source binding changed");
    chmodSync(join(cwd, "file.txt"), 0o755);
    writeFileSync(join(cwd, "new*.txt"), "literal untracked\n");
    symlinkSync("file.txt", join(cwd, "source-link"));
    expect(await inspectGit(cwd)).toEqual(inspectLegacyGit(cwd));
  });
});

// Git itself invokes a fixed external diff, not a replacement Git executable or
// mocked child process. IPC readiness proves the real descendant has started.
function slowGit(root: string, cwd: string) {
  const script = join(root, "slow-diff.mjs");
  const readyPath = join(root, "ready.json");
  writeFileSync(
    script,
    `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (process.argv[2] === 'leaf') {
  process.send('ready'); setInterval(() => {}, 1000);
} else {
  const leaf = spawn(process.execPath, [process.argv[1], 'leaf'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  leaf.once('message', () => writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify([process.pid, leaf.pid])));
  process.on('SIGTERM', () => { leaf.once('exit', () => process.exit(0)); leaf.kill('SIGTERM'); });
}
`,
  );
  writeFileSync(join(cwd, "file.txt"), "changed\n");
  let notify: () => void = () => {};

  const ready = new Promise<void>((resolve) => {
    notify = resolve;
  });

  const watcher = watch(root, () => {
    if (existsSync(readyPath)) notify();
  });

  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

  return {
    ready,
    close: () => watcher.close(),
    pids: () => {
      const pids: unknown = JSON.parse(readFileSync(readyPath, "utf8"));

      if (
        !Array.isArray(pids) ||
        !pids.every((pid): pid is number => Number.isSafeInteger(pid) && pid > 0)
      )
        throw new Error("Invalid process readiness receipt");

      return pids;
    },
    command: `${quote(process.execPath)} ${quote(script)}`,
    argv: ["-c", `diff.external=${quote(process.execPath)} ${quote(script)}`, "diff", "--ext-diff"],
  };
}

for (const reason of ["timeout", "cancelled"] as const) {
  test(`slow real Git ${reason} leaves the task owner responsive and drains the actual process group`, async () => {
    await fixture(async (root, cwd) => {
      const host = await DurableTaskHost.start(
        { repositoryRoot: cwd, stateDir: join(root, "state"), models: createModels() },
        BACKGROUND_CONTEXT,
      );

      const controller = new AbortController();
      const slow = slowGit(root, cwd);
      let finished = false;
      const deadline = Date.now() + (reason === "timeout" ? 1000 : 5000);

      const running = executeGit({
        cwd,
        argv: slow.argv,
        paths: ["file.txt"],
        deadline,
        signal: controller.signal,
      }).then(
        () => {
          throw new Error("Slow Git unexpectedly succeeded");
        },
        (error: Error) => {
          finished = true;

          return error;
        },
      );

      try {
        await Promise.race([
          slow.ready,
          running.then(() => {
            throw new Error("Git ended before descendant readiness");
          }),
        ]);
        const status = await host.inspect(BACKGROUND_CONTEXT);
        expect(status.metadata.taskId).toBe(host.taskId);
        await nextTurn();
        expect(finished).toBe(false);

        if (reason === "cancelled") controller.abort();
        const error = await running;
        expect(error).toBeInstanceOf(GitExecutionError);

        if (!(error instanceof GitExecutionError)) throw error;
        expect(error.outcome).toMatchObject({ reason, quiescent: true });
        expect(processGroupExists(error.outcome.pid!)).toBe(false);

        for (const pid of slow.pids()) expect(() => process.kill(pid, 0)).toThrow();
        expect(Date.now()).toBeLessThan(deadline + 5000);
      } finally {
        controller.abort();
        await running;
        slow.close();
        await host.close(BACKGROUND_CONTEXT);
      }
    });
  });
}

test("an owner-reachable fingerprint respects cancellation without blocking status or close", async () => {
  await fixture(async (root, cwd) => {
    const repository = await inspectGit(cwd);

    const host = await DurableTaskHost.start(
      { repositoryRoot: cwd, stateDir: join(root, "state"), models: createModels() },
      BACKGROUND_CONTEXT,
    );

    const controller = new AbortController();
    controller.abort(new Error("operator stop"));

    try {
      await expect(
        host.workspaces.admit(
          repository,
          [],
          "fixture",
          withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
        ),
      ).rejects.toThrow("operator stop");
      expect((await host.inspect(BACKGROUND_CONTEXT)).metadata.taskId).toBe(host.taskId);
    } finally {
      await host.close(BACKGROUND_CONTEXT);
    }
  });
});

test("expired absolute deadlines and pre-cancelled calls start no Git operation", async () => {
  await fixture(async (_root, cwd) => {
    await expect(
      executeGit({
        cwd,
        argv: ["status"],
        deadline: Date.now() - 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("deadline expired");
    const controller = new AbortController();
    controller.abort(new Error("cancelled before spawn"));
    await expect(
      executeGit({ cwd, argv: ["status"], deadline: Date.now() + 1000, signal: controller.signal }),
    ).rejects.toThrow("cancelled before spawn");
  });
});

test(
  "active workspace checkout cancellation drains Git before owner close and retains the unsafe admission intent",
  { timeout: 10_000 },
  async () => {
    await fixture(async (root, cwd) => {
      const slow = slowGit(root, cwd);
      writeFileSync(join(cwd, ".gitattributes"), "file.txt filter=slow\n");
      setupGit(cwd, ["add", "file.txt", ".gitattributes"]);
      setupGit(cwd, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "smudge fixture",
      ]);
      setupGit(cwd, ["config", "filter.slow.smudge", slow.command]);
      const repository = await inspectGit(cwd);

      const host = await DurableTaskHost.start(
        { repositoryRoot: cwd, stateDir: join(root, "state"), models: createModels() },
        BACKGROUND_CONTEXT,
      );

      const controller = new AbortController();
      const worktree = join(root, "writer");

      const running = host.workspaces
        .admit(
          repository,
          [
            {
              kind: "create",
              id: "writer",
              worktree,
              branch: "feature/writer",
              base: repository.head,
              writePaths: ["file.txt"],
              contextHashes: [],
            },
          ],
          "Operator approved controlled checkout fixture",
          withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
        )
        .then(
          () => {
            throw new Error("Checkout unexpectedly succeeded");
          },
          (error: Error) => error,
        );

      try {
        await slow.ready;
        expect((await host.inspect(BACKGROUND_CONTEXT)).metadata.taskId).toBe(host.taskId);
        const intent = await host.harness.snapshot(WorkspacesDoc, BACKGROUND_CONTEXT);
        expect(intent?.effects[0]?.status).toBe("intent");
        expect(intent?.assignments[0]?.status).toBe("pending");
        controller.abort();
        const closing = host.close(BACKGROUND_CONTEXT);
        const error = await running;
        expect(error).toBeInstanceOf(GitExecutionError);

        if (!(error instanceof GitExecutionError)) throw error;
        expect(error.outcome).toMatchObject({ reason: "cancelled", quiescent: true });
        await closing;

        for (const pid of slow.pids()) expect(() => process.kill(pid, 0)).toThrow();
        const assignment = intent?.assignments[0];

        if (!assignment) throw new Error("Missing real assignment intent");
        expect(readFileSync(join(assignment.claimDirectory, "reservation.json"), "utf8")).toContain(
          host.taskId,
        );
        expect(await inspectGit(cwd)).toEqual(repository);

        const reopened = await DurableTaskHost.reopen(
          { taskId: host.taskId, stateDir: join(root, "state"), models: createModels() },
          BACKGROUND_CONTEXT,
        );

        try {
          expect(reopened.workspaces.blockedReason).toMatch(
            /Unresolved workspace admission intent/,
          );
          expect(
            (await reopened.harness.snapshot(WorkspacesDoc, BACKGROUND_CONTEXT))?.effects[0]
              ?.status,
          ).toBe("intent");
        } finally {
          await reopened.close(BACKGROUND_CONTEXT);
        }
      } finally {
        controller.abort();
        await running;
        slow.close();
        await host.close(BACKGROUND_CONTEXT);
      }
    });
  },
);

test(
  "an unsupported escaped stream fails closed and retains real task/store and assignment ownership",
  { timeout: 20_000 },
  async () => {
    await fixture(async (root, cwd) => {
      const slow = slowGit(root, cwd);
      // This intentionally exceeds the supported same-group child contract. It
      // proves unresolved disposition/lock retention, NOT daemon containment.
      writeFileSync(
        join(root, "slow-diff.mjs"),
        `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (process.argv[2] === 'leaf') {
  process.send('ready');
  process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(join(root, "escaped-exit"))}, 'exiting'); process.exit(0); });
  setInterval(() => {}, 1000);
} else {
  const leaf = spawn(process.execPath, [process.argv[1], 'leaf'], { detached: true, stdio: ['ignore', process.stdout, process.stderr, 'ipc'] });
  leaf.once('message', () => {
    writeFileSync(${JSON.stringify(join(root, "ready.json"))}, JSON.stringify([process.pid, leaf.pid]));
    leaf.disconnect(); leaf.unref();
  });
}
`,
      );
      writeFileSync(join(cwd, ".gitattributes"), "file.txt filter=slow\n");
      setupGit(cwd, ["add", "file.txt", ".gitattributes"]);
      setupGit(cwd, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "escaped stream fixture",
      ]);
      setupGit(cwd, ["config", "filter.slow.smudge", slow.command]);
      const binding = await inspectGit(cwd);

      const owner = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./fixtures/git-execution-owner.mjs", import.meta.url)),
          join(root, "state"),
          cwd,
          join(root, "writer"),
        ],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );

      if (!owner.stdout || !owner.stderr) throw new Error("Missing fixture owner pipes");
      const reader = createInterface({ input: owner.stdout });
      const exited = once(owner, "exit");
      let stderr = "";
      owner.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const watchdog = setTimeout(() => owner.kill("SIGKILL"), 18_000);

      try {
        await Promise.race([
          slow.ready,
          exited.then(() => {
            throw new Error(`Owner exited before descendant readiness: ${stderr}`);
          }),
        ]);
        owner.send("cancel");
        const line = await reader[Symbol.asyncIterator]().next();

        if (!line.value) throw new Error(`Owner did not report unresolved activity: ${stderr}`);
        const receipt: unknown = JSON.parse(line.value);
        expect(receipt).toMatchObject({
          closeRejected: true,
          assignmentStatus: "pending",
          effectStatus: "intent",
          outcome: { reason: "cancelled", quiescent: false },
          blockedReason: expect.stringContaining("activity unresolved"),
        });

        const taskId = /"taskId":"([0-9a-f-]+)"/.exec(line.value)?.[1];

        if (!taskId) throw new Error("Missing real task UUID in owner receipt");
        await expect(
          DurableTaskHost.reopen(
            { taskId, stateDir: join(root, "state"), models: createModels() },
            BACKGROUND_CONTEXT,
          ),
        ).rejects.toThrow(/live owner/);
        await expect(
          acquireClaim(binding.commonDirectory, join(root, "writer"), false),
        ).rejects.toThrow(/live owner/);
        const escapedPid = slow.pids()[1];

        if (!escapedPid) throw new Error("Missing escaped process readiness");
        expect(() => process.kill(escapedPid, 0)).not.toThrow();
      } finally {
        // Only test-owned disposable processes are terminated; no runtime force
        // release is called and the failed owner never reports clean closure.
        if (existsSync(join(root, "ready.json"))) {
          const escapedPid = slow.pids()[1];

          if (escapedPid) {
            let acknowledged: () => void = () => {};

            const stopped = new Promise<void>((resolve) => {
              acknowledged = resolve;
            });

            const watcher = watch(root, () => {
              if (existsSync(join(root, "escaped-exit"))) acknowledged();
            });

            try {
              process.kill(escapedPid, "SIGTERM");
              await stopped;
            } finally {
              watcher.close();
            }
          }
        }

        owner.kill("SIGKILL");
        await exited;
        reader.close();
        slow.close();
        clearTimeout(watchdog);
      }
    });
  },
);

test("fingerprint inspection shares one absolute deadline across sequential Git commands", async () => {
  await fixture(async (root, cwd) => {
    const slow = slowGit(root, cwd);
    writeFileSync(join(cwd, ".gitattributes"), "file.txt filter=slow\n");
    setupGit(cwd, ["add", "file.txt", ".gitattributes"]);
    setupGit(cwd, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "controlled clean filter",
    ]);
    setupGit(cwd, ["config", "filter.slow.clean", slow.command]);
    // Preserve the indexed byte length so Git must run the clean filter rather
    // than answering modified from its size-only stat fast path.
    writeFileSync(join(cwd, "file.txt"), "mutated\n");
    const started = Date.now();

    const running = inspectGit(cwd, {
      deadline: started + 1000,
      signal: new AbortController().signal,
    }).then(
      () => {
        throw new Error("Controlled Git inspection unexpectedly completed");
      },
      (error: Error) => error,
    );

    try {
      // Git's actual status/clean-filter phase follows the earlier rev-parse and
      // ls-files commands. No assertion depends on a minimum polling delay.
      await Promise.race([
        slow.ready,
        running.then((error) => {
          throw error;
        }),
      ]);
      const error = await running;
      expect(error).toBeInstanceOf(GitExecutionError);

      if (!(error instanceof GitExecutionError)) throw error;
      expect(error.outcome).toMatchObject({ reason: "timeout", quiescent: true });
      expect(Date.now() - started).toBeLessThan(3000);

      for (const pid of slow.pids()) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await running;
      slow.close();
    }
  });
});

test("external context fingerprints preserve source hashes and honor cancellation and deadlines", async () => {
  await fixture(async (root) => {
    const path = join(root, "approved-context");
    writeFileSync(path, "approved external context\n");

    const sources = [
      { path, sha256: createHash("sha256").update("approved external context\n").digest("hex") },
    ];

    await verifyContextHashes(sources);
    const controller = new AbortController();
    controller.abort(new Error("context read cancelled"));
    await expect(
      verifyContextHashes(sources, { deadline: Date.now() + 5000, signal: controller.signal }),
    ).rejects.toThrow("context read cancelled");
    await expect(
      verifyContextHashes(sources, {
        deadline: Date.now() - 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("deadline expired");
    writeFileSync(path, "changed external context\n");
    await expect(verifyContextHashes(sources)).rejects.toThrow("hash is stale");
  });
});

for (const tracked of [true, false]) {
  test(`framed fingerprints distinguish real ${tracked ? "tracked" : "untracked"} two-file boundary collisions and reject old bindings`, async () => {
    await fixture(async (_root, cwd) => {
      writeFileSync(join(cwd, "a"), "baseline a\n");
      writeFileSync(join(cwd, "b"), "baseline b\n");

      if (tracked) {
        setupGit(cwd, ["add", "a", "b"]);
        setupGit(cwd, [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-m",
          "two tracked sources",
        ]);
      }

      const boundary = JSON.stringify(["b", lstatSync(join(cwd, "b")).mode]);
      writeFileSync(join(cwd, "a"), tracked ? `X${boundary}Y` : "");
      writeFileSync(join(cwd, "b"), tracked ? "Z" : boundary);
      const first = await inspectGit(cwd);
      const oldFirst = inspectLegacyGit(cwd, "legacy");
      await expect(requireSameGit(oldFirst)).rejects.toThrow(/source binding changed/);
      writeFileSync(join(cwd, "a"), tracked ? "X" : boundary);
      writeFileSync(join(cwd, "b"), tracked ? `Y${boundary}Z` : "");
      const second = await inspectGit(cwd);
      const oldSecond = inspectLegacyGit(cwd, "legacy");
      // These independently constructed sources really collide in the old
      // encoding with the same status/index/modes, not SHA-256 itself.
      expect(oldSecond.sourceHash).toBe(oldFirst.sourceHash);
      expect(second.sourceHash).not.toBe(first.sourceHash);
      await expect(requireSameGit(first)).rejects.toThrow(/source binding changed/);
    });
  });
}

test("raw symlink target bytes cannot collapse through replacement decoding and v2 bindings stay stale", async () => {
  await fixture(async (_root, cwd) => {
    const link = join(cwd, "raw-target");
    symlinkSync(Buffer.from([0xff]), link);
    const first = await inspectGit(cwd);
    const old = inspectLegacyGit(cwd, "v2");
    const lossy = readlinkSync(link);
    expect(readlinkSync(link, { encoding: "buffer" })).toEqual(Buffer.from([0xff]));
    await expect(requireSameGit(old)).rejects.toThrow(/source binding changed/);
    unlinkSync(link);
    symlinkSync(Buffer.from([0xfe]), link);
    expect(readlinkSync(link)).toBe(lossy);
    expect(readlinkSync(link, { encoding: "buffer" })).toEqual(Buffer.from([0xfe]));
    expect((await inspectGit(cwd)).sourceHash).not.toBe(first.sourceHash);
    await expect(requireSameGit(first)).rejects.toThrow(/source binding changed/);
  });
});

test("invalid byte filenames are rejected before binding, while a real replacement-character name remains valid", async () => {
  await fixture(async (_root, cwd) => {
    const invalid = Buffer.concat([Buffer.from(`${cwd}/raw-`), Buffer.from([0xff])]);
    let created = false;

    try {
      writeFileSync(invalid, "A");
      created = true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error)) throw error;
      expect(["EILSEQ", "EINVAL"]).toContain(error.code);
      console.info(
        `Observed filesystem rejection of actual invalid-byte pathname: ${error.code}; Linux byte-path acceptance case remains platform-required`,
      );
    }

    if (created) {
      await expect(inspectGit(cwd)).rejects.toThrow(/not valid UTF-8/);
      writeFileSync(invalid, "B");
      await expect(inspectGit(cwd)).rejects.toThrow(/not valid UTF-8/);
      unlinkSync(invalid);
    }

    const replacement = join(cwd, "raw-\uFFFD");
    writeFileSync(replacement, "A");
    const first = await inspectGit(cwd);
    writeFileSync(replacement, "B");
    expect((await inspectGit(cwd)).sourceHash).not.toBe(first.sourceHash);
  });
});
