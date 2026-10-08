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
import { waitForCommand } from "./wait-for-command.js";

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
  await waitForCommand(runtime, input.key, "completed");
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

test("command versions and ordered events survive reconnect and restart", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "receipt-one";
    },
  };
  const input = { key: "versioned", operation: "probe" };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  let finalVersion: number;
  try {
    assert.equal((await runtime.state()).version, 0);
    const reserved = await runtime.submitVersioned(input, 0);
    assert.equal(reserved.version, 1);
    await assert.rejects(
      runtime.submitVersioned({ key: "stale", operation: "probe" }, 0),
      /version changed/,
    );
    assert.equal(
      (await runtime.submitVersioned(input, 0)).taskId,
      reserved.taskId,
    );
    await waitForCommand(runtime, input.key, "completed");
    const snapshot = await runtime.state();
    finalVersion = snapshot.version;
    assert.equal(
      snapshot.commands[input.key]?.receipt?.reference,
      "receipt-one",
    );
    const history = await runtime.eventsAfter(0);
    assert.equal(history.version, finalVersion);
    assert.deepEqual(
      history.events.map((event) => event.position),
      Array.from({ length: finalVersion }, (_, index) => index + 1),
    );
    assert.equal(history.events[0]?.command.status, "queued");
    assert.equal(history.events.at(-1)?.command.status, "completed");
    assert.deepEqual((await runtime.eventsAfter(finalVersion)).events, []);
    history.events[0]!.command.status = "failed";
    assert.equal(
      (await runtime.eventsAfter(0)).events[0]?.command.status,
      "queued",
    );
  } finally {
    await runtime.close();
  }
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  try {
    assert.equal((await recovered.state()).version, finalVersion!);
    assert.equal(
      (await recovered.eventsAfter(0)).events.at(-1)?.command.status,
      "completed",
    );
  } finally {
    await recovered.close();
  }
});

test("oversized command identifiers cannot enter the durable event log", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "receipt";
    },
  });
  try {
    await assert.rejects(
      runtime.submit({ key: "k".repeat(257), operation: "probe" }),
      /at most 256 characters/,
    );
    await assert.rejects(
      runtime.submit({ key: "valid", operation: "o".repeat(257) }),
      /at most 256 characters/,
    );
    assert.deepEqual(await runtime.state(), { version: 0, commands: {} });
  } finally {
    await runtime.close();
  }
});

test("idempotency keys matching inherited object names remain distinct reservations", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute(input: { key: string }) {
      return `receipt-${input.key}`;
    },
  };
  const keys = ["constructor", "toString", "__proto__"];
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const ids = new Map<string, number>();
  try {
    await runtime.submit({ key: "ordinary", operation: "probe" });
    await waitForCommand(runtime, "ordinary", "completed");
    for (const key of keys) assert.equal(await runtime.command(key), undefined);
    for (const key of keys) {
      const input = { key, operation: "probe" };
      const id = await runtime.submit(input);
      ids.set(key, id);
      assert.equal(await runtime.submit(input), id);
    }
    for (const key of keys) {
      await waitForCommand(runtime, key, "completed");
      assert.equal(
        (await runtime.command(key))?.receipt?.reference,
        `receipt-${key}`,
      );
    }
  } finally {
    await runtime.close();
  }
  const reopened = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  try {
    for (const key of keys) {
      assert.equal(
        await reopened.submit({ key, operation: "probe" }),
        ids.get(key),
      );
      assert.equal(
        (await reopened.command(key))?.receipt?.reference,
        `receipt-${key}`,
      );
    }
  } finally {
    await reopened.close();
  }
});

test("command reads cannot mutate the authoritative live state", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "stable-receipt";
    },
  });
  try {
    await runtime.submit({ key: "detached", operation: "probe" });
    await waitForCommand(runtime, "detached", "completed");
    const result = await runtime.command("detached");
    assert.equal(result?.status, "completed");
    assert.ok(result.receipt);
    Reflect.set(result, "status", "failed");
    Reflect.set(result.receipt, "reference", "corrupted");
    const reread = await runtime.command("detached");
    assert.equal(reread?.status, "completed");
    assert.equal(reread.receipt?.reference, "stable-receipt");
  } finally {
    await runtime.close();
  }
});

test("editing a running command read cannot block its receipt", async (t) => {
  const root = await tempRoot();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let invoked!: () => void;
  let finish!: (reference: string) => void;
  const started = new Promise<void>((resolve) => {
    invoked = resolve;
  });
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      invoked();
      return pending;
    },
  });
  try {
    await runtime.submit({ key: "running-read", operation: "probe" });
    await started;
    const read = await runtime.command("running-read");
    assert.ok(read);
    assert.equal(read.status, "running");
    Reflect.set(read, "status", "failed");
    finish("actual-receipt");
    await waitForCommand(runtime, "running-read", "completed");
    assert.equal(
      (await runtime.command("running-read"))?.receipt?.reference,
      "actual-receipt",
    );
  } finally {
    finish("cleanup");
    await runtime.close();
  }
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
  await waitForCommand(runtime, "safe", "completed");
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
  await waitForCommand(runtime, "unsafe-ok", "completed");
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
  await waitForCommand(recovered, "interrupted", "needs_reconciliation");
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
  await waitForCommand(recovered, "crash-after-effect", "needs_reconciliation");
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
    await waitForCommand(recovered, "crash-after-effect", "completed");
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
    await waitForCommand(recovered, "crash-after-effect", "completed");
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
    await waitForCommand(runtime, "hung", "needs_reconciliation", 250);
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
  await waitForCommand(recovered, "closing", "needs_reconciliation");
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
    await waitForCommand(runtime, "unsafe-hung", "needs_reconciliation", 250);
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
  await waitForCommand(runtime, "unsafe", "needs_reconciliation");
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
