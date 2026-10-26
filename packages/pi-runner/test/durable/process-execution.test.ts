import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { processGroupExists, runProcess } from "../../src/durable/process-execution.js";

const script = fileURLToPath(new URL("./fixtures/capabilities-check.mjs", import.meta.url));

async function fixture(check: (directory: string) => Promise<void>) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kstack-process-execution-")));

  try {
    await check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("shared process execution separates stdout/stderr and observes root, streams and group exit", async () => {
  await fixture(async (directory) => {
    const outcome = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write('stdout'); process.stderr.write('stderr')"],
      directory,
      process.env,
      5000,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      reason: "exited",
      exitCode: 0,
      stdout: "stdout",
      stdoutValidUtf8: true,
      stderr: "stderr",
      outputBytes: 12,
      quiescent: true,
    });
    expect(outcome.pid).not.toBeNull();
    expect(processGroupExists(outcome.pid!)).toBe(false);
  });
});

test("cancellation remains responsive and returns only after the actual root and descendants drain", async () => {
  await fixture(async (directory) => {
    const controller = new AbortController();
    let ready: () => void = () => {};

    const observed = new Promise<void>((resolve) => {
      ready = resolve;
    });

    const watcher = watch(directory, () => {
      if (existsSync(join(directory, "ready.txt"))) ready();
    });

    let finished = false;

    const running = runProcess(
      process.execPath,
      [script, "tree"],
      directory,
      process.env,
      5000,
      controller.signal,
    ).then((outcome) => {
      finished = true;

      return outcome;
    });

    try {
      await Promise.race([
        observed,
        running.then(() => {
          throw new Error("Process ended before descendant readiness");
        }),
      ]);
      await nextTurn();
      expect(finished).toBe(false);

      const pids = readFileSync(join(directory, "ready.txt"), "utf8")
        .trim()
        .split("\n")
        .map(Number);

      controller.abort();
      const outcome = await running;
      expect(outcome).toMatchObject({ reason: "cancelled", quiescent: true });
      expect(processGroupExists(pids[0]!)).toBe(false);

      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      watcher.close();
      controller.abort();
      await running;
    }
  });
});

test("root exit alone cannot certify a still-live inherited group", async () => {
  await fixture(async (directory) => {
    const outcome = await runProcess(
      process.execPath,
      [script, "orphan"],
      directory,
      process.env,
      5000,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({ reason: "descendants", quiescent: true });

    for (const pid of readFileSync(join(directory, "ready.txt"), "utf8")
      .trim()
      .split("\n")
      .map(Number))
      expect(() => process.kill(pid, 0)).toThrow();
  });
});

test(
  "an ignored TERM escalates after the original five-second grace and is observed gone",
  { timeout: 12_000 },
  async () => {
    await fixture(async (directory) => {
      const started = Date.now();

      const outcome = await runProcess(
        process.execPath,
        [script, "ignore"],
        directory,
        process.env,
        200,
        new AbortController().signal,
      );

      expect(outcome).toMatchObject({ reason: "timeout", quiescent: true });
      expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(processGroupExists(outcome.pid!)).toBe(false);
    });
  },
);

test("combined output is bounded to one MiB even for invalid UTF-8 and is drained", async () => {
  await fixture(async (directory) => {
    const outcome = await runProcess(
      process.execPath,
      [
        "-e",
        "const fs=require('fs'); fs.writeSync(1,Buffer.alloc(1048576,255)); fs.writeSync(2,Buffer.alloc(100,255))",
      ],
      directory,
      process.env,
      5000,
      new AbortController().signal,
    );

    expect(outcome.stdoutValidUtf8).toBe(false);
    expect(outcome).toMatchObject({
      reason: "output-limit",
      outputBytes: 1024 * 1024,
      quiescent: true,
    });

    for (const text of [outcome.output, outcome.stdout, outcome.stderr])
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024 * 1024);
  });
});

test("spawn failure and pre-abort never masquerade as successful execution", async () => {
  await fixture(async (directory) => {
    const outcome = await runProcess(
      join(directory, "missing-executable"),
      [],
      directory,
      process.env,
      1000,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      reason: "spawn-error",
      pid: null,
      exitCode: null,
      quiescent: true,
    });
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    await expect(
      runProcess(process.execPath, [], directory, process.env, 1000, controller.signal),
    ).rejects.toThrow("already cancelled");
  });
});
