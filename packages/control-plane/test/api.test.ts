import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  ControlPlaneApiError,
  createControlPlaneClient,
  startApiServer,
} from "../src/api/index.js";
import { openControlPlane } from "../src/runtime/open.js";
import { waitForCommand } from "./wait-for-command.js";

const deviceId = "test-device";
const credential = "test-secret-".repeat(4);
const otherDevice = "second-device";
const otherCredential = "second-secret-".repeat(4);

async function fixture(t: {
  onTestFinished: (fn: () => Promise<void>) => void;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-api-"));
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "receipt-one";
    },
  };
  const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const server = await startApiServer({
    runtime,
    deviceCredentials: {
      [deviceId]: credential,
      [otherDevice]: otherCredential,
    },
  });
  t.onTestFinished(async () => {
    await server.close();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    runtime,
    server,
    client: createControlPlaneClient({ url: server.url, deviceId, credential }),
  };
}

test("versioned clients share durable commands, reject stale writes, and authenticate every route", async (t) => {
  const { runtime, server, client } = await fixture(t);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:/);
  assert.throws(
    () =>
      createControlPlaneClient({
        url: "http://public.example",
        deviceId,
        credential,
      }),
    /loopback or private Tailscale/,
  );
  assert.throws(
    () =>
      createControlPlaneClient({
        url: "https://public.example",
        deviceId,
        credential,
      }),
    /loopback or private Tailscale/,
  );
  assert.ok(
    createControlPlaneClient({
      url: "https://host.tail.ts.net",
      deviceId,
      credential,
    }),
  );
  assert.deepEqual(await client.health(), { status: "ok", apiVersion: 1 });
  assert.equal((await client.state()).version, 0);
  const input = { key: "one", operation: "probe", expectedVersion: 0 };
  const accepted = await client.submit(input);
  assert.equal(accepted.version, 1);
  const duplicate = await client.submit(input);
  assert.equal(duplicate.taskId, accepted.taskId);
  await assert.rejects(
    client.submit({ ...input, key: "two" }),
    (error) =>
      error instanceof ControlPlaneApiError &&
      error.status === 409 &&
      error.code === "STALE_VERSION",
  );
  await assert.rejects(
    client.submit({ ...input, operation: "other" }),
    (error) =>
      error instanceof ControlPlaneApiError &&
      error.status === 409 &&
      error.code === "KEY_CONFLICT",
  );
  await waitForCommand(runtime, input.key, "completed");
  assert.equal(
    (await client.command(input.key)).receipt?.reference,
    "receipt-one",
  );
  assert.equal((await client.state()).commands[input.key]?.status, "completed");
  const unusualKey = "../state?%#";
  await client.submit({
    key: unusualKey,
    operation: "probe",
    expectedVersion: (await client.state()).version,
  });
  await waitForCommand(runtime, unusualKey, "completed");
  assert.equal((await client.command(unusualKey)).key, unusualKey);

  assert.deepEqual(
    await createControlPlaneClient({
      url: server.url,
      deviceId: otherDevice,
      credential: otherCredential,
    }).health(),
    { status: "ok", apiVersion: 1 },
  );
  await assert.rejects(
    createControlPlaneClient({
      url: server.url,
      deviceId: otherDevice,
      credential,
    }).health(),
    (error) => error instanceof ControlPlaneApiError && error.status === 401,
  );
  const unauthenticated = createControlPlaneClient({
    url: server.url,
    deviceId,
    credential: "bad-token",
  });
  await assert.rejects(
    unauthenticated.health(),
    (error) => error instanceof ControlPlaneApiError && error.status === 401,
  );
  const wrongVersion = await fetch(`${server.url}/v1/health`, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "X-Kriscard-Device-Id": deviceId,
      "X-Kriscard-Api-Version": "2",
    },
  });
  assert.equal(wrongVersion.status, 426);
  const missingToken = await fetch(`${server.url}/v1/state`, {
    headers: { "X-Kriscard-Api-Version": "1" },
  });
  assert.equal(missingToken.status, 401);
});

test("a port conflict fails without disrupting the active API", async (t) => {
  const { runtime, server, client } = await fixture(t);
  await assert.rejects(
    startApiServer({
      runtime,
      deviceCredentials: { [deviceId]: credential },
      port: Number(new URL(server.url).port),
    }),
    (error) =>
      error instanceof Error && "code" in error && error.code === "EADDRINUSE",
  );
  assert.equal((await client.health()).status, "ok");
});

test("concurrent clients cannot both submit against the same version", async (t) => {
  const { client } = await fixture(t);
  const results = await Promise.allSettled([
    client.submit({ key: "left", operation: "probe", expectedVersion: 0 }),
    client.submit({ key: "right", operation: "probe", expectedVersion: 0 }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof ControlPlaneApiError);
  assert.equal(rejected.reason.code, "STALE_VERSION");
  assert.equal(Object.keys((await client.state()).commands).length, 1);
});

test("SSE delivers ordered positions after a disconnect and detects invalid positions", async (t) => {
  const { runtime, client } = await fixture(t);
  const stream = client.events(0);
  const firstEvent = stream.next();
  await client.submit({
    key: "streamed",
    operation: "probe",
    expectedVersion: 0,
  });
  const first = await firstEvent;
  assert.equal(first.value?.position, 1);
  assert.equal(first.value?.command.status, "queued");
  await stream.return(undefined);
  await waitForCommand(runtime, "streamed", "completed");
  const replay = client.events(first.value!.position);
  const positions: number[] = [];
  try {
    for await (const event of replay) {
      positions.push(event.position);
      if (event.command.status === "completed") break;
    }
  } finally {
    await replay.return(undefined);
  }
  assert.deepEqual(
    positions,
    Array.from(
      { length: (await runtime.state()).version - 1 },
      (_, i) => i + 2,
    ),
  );
  await assert.rejects(
    client.events(9_999).next(),
    (error) => error instanceof ControlPlaneApiError && error.status === 400,
  );
});

test("a new daemon serves the same persisted event positions after restart", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-api-restart-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const adapter = {
    classify: () => "idempotent_with_key" as const,
    async execute() {
      return "persisted-receipt";
    },
  };
  const firstRuntime = await openControlPlane(
    root,
    BACKGROUND_CONTEXT,
    adapter,
  );
  const firstServer = await startApiServer({
    runtime: firstRuntime,
    deviceCredentials: { [deviceId]: credential },
  });
  let lastPosition: number;
  try {
    const firstClient = createControlPlaneClient({
      url: firstServer.url,
      deviceId,
      credential,
    });
    await firstClient.submit({
      key: "restart",
      operation: "probe",
      expectedVersion: 0,
    });
    await waitForCommand(firstRuntime, "restart", "completed");
    lastPosition = (await firstClient.state()).version;
  } finally {
    await firstServer.close();
    await firstRuntime.close();
  }
  const recovered = await openControlPlane(root, BACKGROUND_CONTEXT, adapter);
  const secondServer = await startApiServer({
    runtime: recovered,
    deviceCredentials: { [deviceId]: credential },
  });
  try {
    const secondClient = createControlPlaneClient({
      url: secondServer.url,
      deviceId,
      credential,
    });
    const events = secondClient.events(0);
    const first = await events.next();
    assert.equal(first.value?.position, 1);
    await events.return(undefined);
    assert.equal((await secondClient.state()).version, lastPosition!);
    assert.equal(
      (await secondClient.command("restart")).receipt?.reference,
      "persisted-receipt",
    );
  } finally {
    await secondServer.close();
    await recovered.close();
  }
});

test("large opaque artifacts stream intact and public binding is rejected", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-api-"));
  const runtime = await openControlPlane(root);
  t.onTestFinished(async () => {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(
    startApiServer({
      runtime,
      deviceCredentials: { [deviceId]: credential },
      host: "0.0.0.0",
    }),
    /loopback IP/,
  );
  const bytes = randomBytes(2 * 1024 * 1024);
  const id = "artifact_0123456789abcdef";
  const server = await startApiServer({
    runtime,
    deviceCredentials: { [deviceId]: credential },
    artifact: async (opaqueId) =>
      opaqueId === id
        ? {
            bytes: (async function* () {
              for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
                yield bytes.subarray(offset, offset + 64 * 1024);
            })(),
          }
        : undefined,
  });
  t.onTestFinished(() => server.close());
  const client = createControlPlaneClient({
    url: server.url,
    deviceId,
    credential,
  });
  await assert.rejects(
    client.submit({
      key: "unconfigured",
      operation: "probe",
      expectedVersion: 0,
    }),
    (error) => error instanceof ControlPlaneApiError && error.status === 503,
  );
  assert.deepEqual(
    Buffer.from(await (await client.artifact(id)).arrayBuffer()),
    bytes,
  );
  await assert.rejects(
    client.artifact("../../state.sqlite"),
    (error) => error instanceof ControlPlaneApiError && error.status === 400,
  );
  await assert.rejects(
    client.artifact("unknown_0123456789abcdef"),
    (error) => error instanceof ControlPlaneApiError && error.status === 404,
  );
});
