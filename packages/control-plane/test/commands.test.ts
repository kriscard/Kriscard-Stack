import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CommandReplayClass } from "../src/runtime/commands.js";
import { openControlPlane } from "../src/runtime/open.js";

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), "kriscard-command-"));
}

async function crashAfterExternalEffect(
  root: string,
  replayClass: CommandReplayClass,
  failures = 0,
) {
  const sideEffectPath = path.join(root, "effect.txt");
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./fixtures/unsafe-crash.mjs", import.meta.url)),
      root,
      sideEffectPath,
      replayClass,
      String(failures),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const [chunk] = await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw new Error("Child exited before the external effect");
      }),
    ]);
    assert.match(String(chunk), /SIDE_EFFECT_DONE/);
    assert.equal(
      await readFile(sideEffectPath, "utf8"),
      "external action happened\n",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  }
  return sideEffectPath;
}

test("a reserved idempotency key produces one durable receipt, even after reopen", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let executions = 0;
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      executions++;
      return "receipt-one";
    },
  };
  const input = {
    key: "key-1",
    operation: "probe",
  } as const;
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const taskId = await runtime.submit(input);
  assert.equal(await runtime.submit(input), taskId);
  await assert.rejects(
    runtime.submit({ ...input, operation: "another" }),
    /Idempotency key/,
  );
  await (
    await runtime.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(executions, 1);
  assert.equal(
    (await runtime.command(input.key))?.receipt?.reference,
    "receipt-one",
  );
  await runtime.close();

  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  assert.equal(await recovered.submit(input), taskId);
  assert.equal(executions, 1);
  assert.equal((await recovered.command(input.key))?.status, "completed");
  await recovered.close();
});

test("only replay-safe commands retry automatically", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let attempts = 0;
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      attempts++;
      if (attempts < 3) throw new Error("temporary failure");
      return "recovered";
    },
  });
  await runtime.submit({
    key: "safe",
    operation: "probe",
  });
  await (
    await runtime.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(attempts, 3);
  assert.equal(
    (await runtime.command("safe"))?.receipt?.reference,
    "recovered",
  );
  await runtime.close();
});

test("an unsafe command can complete once with a durable receipt", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let attempts = 0;
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "manual_recovery" as const,
    async execute() {
      attempts++;
      return "external-reference";
    },
  });
  await runtime.submit({
    key: "unsafe-ok",
    operation: "probe",
  });
  await (
    await runtime.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(attempts, 1);
  assert.equal(
    (await runtime.command("unsafe-ok"))?.receipt?.reference,
    "external-reference",
  );
  await runtime.close();
});

test("an unsafe intent interrupted before its receipt is not dispatched again", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let started!: () => void;
  const invoked = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  const adapter = {
    classify: () => "manual_recovery" as const,
    async execute(_input: unknown, signal: AbortSignal): Promise<string> {
      attempts++;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("interrupted")),
          { once: true },
        );
      });
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const submission = runtime.submit({
    key: "interrupted",
    operation: "probe",
  });
  await invoked;
  assert.equal((await runtime.command("interrupted"))?.status, "running");
  await runtime.close();
  await submission;

  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  await (
    await recovered.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(attempts, 1);
  assert.equal(
    (await recovered.command("interrupted"))?.status,
    "needs_reconciliation",
  );
  await recovered.close();
});

test("process death after an external effect cannot replay its unsafe intent", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sideEffectPath = await crashAfterExternalEffect(
    root,
    "manual_recovery",
  );
  let repeated = 0;
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "manual_recovery" as const,
    async execute() {
      repeated++;
      return "unexpected replay";
    },
  });
  await (
    await recovered.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(repeated, 0);
  assert.equal(
    (await recovered.command("crash-after-effect"))?.status,
    "needs_reconciliation",
  );
  assert.equal(
    await readFile(sideEffectPath, "utf8"),
    "external action happened\n",
  );
  await recovered.close();
}, 10_000);

test("process death after an idempotent effect resumes with the same key", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sideEffectPath = await crashAfterExternalEffect(
    root,
    "idempotent_with_key",
  );
  await assert.rejects(
    openControlPlane(root, BACKGROUND_CONTEXT, {
      classify: () => "manual_recovery",
      async execute() {
        return "must not run";
      },
    }),
    /Adapter replay policy changed/,
  );
  let recoveredCalls = 0;
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute(input) {
      recoveredCalls++;
      assert.equal(input.key, "crash-after-effect");
      assert.equal(
        await readFile(sideEffectPath, "utf8"),
        "external action happened\n",
      );
      return "existing-external-effect";
    },
  });
  try {
    await (
      await recovered.harness.root(BACKGROUND_CONTEXT)
    ).waitForIdle(BACKGROUND_CONTEXT);
    assert.equal(recoveredCalls, 1);
    assert.equal((await recovered.command("crash-after-effect"))?.attempts, 1);
    assert.equal(
      (await recovered.command("crash-after-effect"))?.receipt?.reference,
      "existing-external-effect",
    );
  } finally {
    await recovered.close();
  }
}, 10_000);

test("the final keyed attempt reconciles after a crash instead of losing its receipt", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sideEffectPath = await crashAfterExternalEffect(
    root,
    "idempotent_with_key",
    2,
  );
  let reconciliations = 0;
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute(input) {
      reconciliations++;
      assert.equal(input.key, "crash-after-effect");
      assert.equal(
        await readFile(sideEffectPath, "utf8"),
        "external action happened\n",
      );
      return "reconciled-final-attempt";
    },
  });
  try {
    await (
      await recovered.harness.root(BACKGROUND_CONTEXT)
    ).waitForIdle(BACKGROUND_CONTEXT);
    assert.equal(reconciliations, 1);
    assert.equal(
      (await recovered.command("crash-after-effect"))?.receipt?.reference,
      "reconciled-final-attempt",
    );
    assert.equal((await recovered.command("crash-after-effect"))?.attempts, 3);
  } finally {
    await recovered.close();
  }
}, 10_000);

test("a hung adapter times out, fences retries, and allows the runtime to close", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let resolveExecution!: (value: string) => void;
  let invoked!: () => void;
  const started = new Promise<void>((resolve) => {
    invoked = resolve;
  });
  const pending = new Promise<string>((resolve) => {
    resolveExecution = resolve;
  });
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    leaseDurationMs: 25,
    async execute() {
      invoked();
      return pending;
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  try {
    await runtime.submit({ key: "hung", operation: "probe" });
    await started;
    const settled = await Promise.race([
      runtime.harness.waitForIdle(BACKGROUND_CONTEXT).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert.equal(
      settled,
      true,
      "lease deadline must settle an uncooperative adapter",
    );
    assert.equal(
      (await runtime.command("hung"))?.status,
      "needs_reconciliation",
    );
  } finally {
    resolveExecution("late-effect");
    await runtime.close();
  }
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      throw new Error("must not redispatch an unknown effect");
    },
  });
  assert.equal(
    (await recovered.command("hung"))?.status,
    "needs_reconciliation",
  );
  await recovered.close();
});

test("closing a runtime does not wait for an adapter that ignores cancellation", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let resolveExecution!: (value: string) => void;
  let invoked!: () => void;
  const started = new Promise<void>((resolve) => {
    invoked = resolve;
  });
  const pending = new Promise<string>((resolve) => {
    resolveExecution = resolve;
  });
  const adapter = {
    classify: () => "manual_recovery" as const,
    async execute() {
      invoked();
      return pending;
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const submission = runtime.submit({ key: "closing", operation: "probe" });
  await started;
  const closing = runtime.close();
  const finishedPromptly = await Promise.race([
    closing.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  resolveExecution("late-effect");
  await closing;
  await submission;
  assert.equal(finishedPromptly, true);
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  await (
    await recovered.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(
    (await recovered.command("closing"))?.status,
    "needs_reconciliation",
  );
  await recovered.close();
});

test("an unsafe hung adapter loses its lease without dispatching again", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let resolveExecution!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    resolveExecution = resolve;
  });
  let calls = 0;
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "manual_recovery" as const,
    leaseDurationMs: 25,
    async execute() {
      calls++;
      return pending;
    },
  });
  try {
    await runtime.submit({ key: "unsafe-hung", operation: "probe" });
    const settled = await Promise.race([
      runtime.harness.waitForIdle(BACKGROUND_CONTEXT).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert.equal(settled, true);
    assert.equal(calls, 1);
    assert.equal(
      (await runtime.command("unsafe-hung"))?.status,
      "needs_reconciliation",
    );
  } finally {
    resolveExecution("late-effect");
    await runtime.close();
  }
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "manual_recovery" as const,
    async execute() {
      calls++;
      return "unexpected";
    },
  });
  assert.equal(
    (await recovered.command("unsafe-hung"))?.status,
    "needs_reconciliation",
  );
  assert.equal(calls, 1);
  await recovered.close();
});

test("an uncertain unsafe command stops and requires reconciliation", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let attempts = 0;
  const adapter = {
    classify: () => "manual_recovery" as const,
    async execute() {
      attempts++;
      throw new Error("timed out after remote side effect");
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  await runtime.submit({
    key: "unsafe",
    operation: "probe",
  });
  await (
    await runtime.harness.root(BACKGROUND_CONTEXT)
  ).waitForIdle(BACKGROUND_CONTEXT);
  assert.equal(attempts, 1);
  assert.equal(
    (await runtime.command("unsafe"))?.status,
    "needs_reconciliation",
  );
  await runtime.close();

  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  assert.equal(
    (await recovered.command("unsafe"))?.status,
    "needs_reconciliation",
  );
  assert.equal(attempts, 1);
  await recovered.close();
});
