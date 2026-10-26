import { once } from "node:events";
import { request as httpRequest, type ClientRequest } from "node:http";
import { connect } from "node:net";
import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessageEventStream, Context } from "@earendil-works/pi-ai";
import { stream as streamNative } from "@earendil-works/pi-ai/api/pi-messages";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import {
  errorEvents,
  protocolUsage,
  textEvents,
  toolEvents,
} from "./fixtures/model-protocol-events.js";
import {
  fixtureApiKey,
  fixtureModel,
  fixtureProvider,
  modelProtocolConfig,
  startModelProtocolServer,
  type ModelProtocolServer,
  type ProtocolStep,
} from "./fixtures/model-protocol-server.js";

const context: Context = {
  systemPrompt: "Deterministic protocol test, no vendor network.",
  messages: [{ role: "user", content: "Give the finite answer.", timestamp: 1 }],
};

async function withProtocol(
  steps: readonly ProtocolStep[],
  check: (server: ModelProtocolServer, runtime: ModelRuntime) => Promise<void>,
  directoryRoot = tmpdir(),
) {
  const directory = await mkdtemp(join(directoryRoot, "kstack-model-protocol-"));
  let server: ModelProtocolServer | undefined;
  const failures: unknown[] = [];
  let cleanupConfirmed = false;
  const modelsPath = join(directory, "models.json");
  const authPath = join(directory, "auth.json");

  try {
    server = await startModelProtocolServer(steps);
    await writeFile(modelsPath, JSON.stringify(modelProtocolConfig(server.baseUrl)), {
      mode: 0o600,
    });
    // Only a new owned empty credential file is read, never the user's auth path.
    await writeFile(authPath, "{}", { mode: 0o600 });

    const runtime = await ModelRuntime.create({
      modelsPath,
      authPath,
      modelsStorePath: join(directory, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });

    expect(runtime.getError()).toBeUndefined();
    await check(server, runtime);
    expect(await readFile(authPath, "utf8")).toBe("{}");
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (server) {
        const closed = await server.close();
        expect(closed).toMatchObject({ closed: true, activeSockets: 0, activeResponses: 0 });
      }

      cleanupConfirmed = true;
    } catch (error) {
      failures.push(error);
      failures.push(
        new Error(`Unconfirmed fixture cleanup; retained owned directory: ${directory}`),
      );
    } finally {
      if (cleanupConfirmed) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
      }
    }
  }

  if (failures.length)
    throw new AggregateError(failures, "Protocol fixture failed; inspect all causes");
}

function model(runtime: ModelRuntime) {
  const resolved = runtime.getModel(fixtureProvider, fixtureModel);

  if (!resolved || resolved.api !== "pi-messages")
    throw new Error("Native fixture model unavailable");

  return resolved;
}

async function eventTypes(stream: AssistantMessageEventStream) {
  const types: string[] = [];

  for await (const event of stream) types.push(event.type);

  return types;
}

test("normal ModelRuntime config sends native HTTP options and streams text/usage", async () => {
  await withProtocol(
    [{ kind: "stream", events: textEvents, holdBeforeEvent: 3 }],
    async (server, runtime) => {
      const statuses: number[] = [];
      const nativeEvents: unknown[] = [];

      const stream = runtime.stream(model(runtime), context, {
        maxTokens: 4096,
        temperature: 0.25,
        maxRetries: 0,
        timeoutMs: 2_000,
        signal: AbortSignal.timeout(3_000),
        headers: { "x-fixture-request": "text" },
        onResponse: (response) => {
          statuses.push(response.status);
        },
        onProviderStreamEvent: (event) => {
          nativeEvents.push(event);
        },
      });

      const types: string[] = [];
      const deltaText: string[] = [];

      for await (const event of stream) {
        types.push(event.type);

        if (event.type === "text_delta") {
          const text = event.partial.content[event.contentIndex];

          if (text.type !== "text") throw new Error("Expected incremental text");
          deltaText.push(text.text);

          if (deltaText.length === 1) {
            await server.waitForHeld(0);
            server.release(0);
          }
        }
      }

      expect(types).toEqual([
        "start",
        "text_start",
        "text_delta",
        "text_delta",
        "text_end",
        "done",
      ]);
      expect(deltaText).toEqual(["finite ", "finite answer"]);
      expect(await stream.result()).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "finite answer" }],
        stopReason: "stop",
        usage: protocolUsage,
        provider: fixtureProvider,
        model: fixtureModel,
      });
      const request = await server.waitForResponseClosed(0);
      expect(request).toMatchObject({
        method: "POST",
        path: "/messages",
        authenticated: true,
        state: "sent",
        body: {
          model: fixtureModel,
          context: {
            messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
          },
          options: { maxTokens: 4096, temperature: 0.25 },
        },
      });
      expect(statuses).toEqual([200]);
      expect(nativeEvents).toEqual(textEvents);
      expect(JSON.stringify(server.requests())).not.toContain(fixtureApiKey);
      expect(server.violations()).toEqual([]);
    },
  );
});

test("the direct pi-ai native client parses incremental tool arguments and usage over HTTP", async () => {
  await withProtocol(
    [{ kind: "stream", events: toolEvents, holdBeforeEvent: 4 }],
    async (server, runtime) => {
      const resolved = model(runtime);

      const stream = streamNative(
        { ...resolved, api: "pi-messages", compat: undefined },
        normalizeContext(context),
        {
          apiKey: fixtureApiKey,
          maxTokens: 16,
          maxRetries: 0,
          signal: AbortSignal.timeout(3_000),
          toolChoice: "required",
        },
      );

      const types: string[] = [];
      const deltaArguments: unknown[] = [];

      for await (const event of stream) {
        types.push(event.type);

        if (event.type === "toolcall_delta") {
          const call = event.partial.content[event.contentIndex];

          if (call.type !== "toolCall") throw new Error("Expected incremental tool call");
          deltaArguments.push(structuredClone(call.arguments));

          if (deltaArguments.length === 2) {
            await server.waitForHeld(0);
            expect(deltaArguments).toEqual([{}, { path: "README.md" }]);
            // Only now may toolcall_end overwrite the live partial tool call.
            server.release(0);
          }
        }
      }

      expect(types).toEqual([
        "start",
        "toolcall_start",
        "toolcall_delta",
        "toolcall_delta",
        "toolcall_end",
        "done",
      ]);
      expect(deltaArguments).toEqual([{}, { path: "README.md" }]);
      expect(await stream.result()).toMatchObject({
        content: [
          {
            type: "toolCall",
            id: "fixture-tool-call-1",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
        stopReason: "toolUse",
        usage: protocolUsage,
      });
      expect((await server.waitForResponseClosed(0)).body).toMatchObject({
        options: { maxTokens: 16, toolChoice: "required" },
      });
      expect(server.violations()).toEqual([]);
    },
  );
});

test("native tool result serialization uses actual prior model output, then consumes the next finite response", async () => {
  await withProtocol(
    [
      { kind: "stream", events: toolEvents },
      { kind: "stream", events: textEvents },
    ],
    async (server, runtime) => {
      const first = await runtime.completeSimple(model(runtime), context, {
        maxTokens: 16,
        maxRetries: 0,
        signal: AbortSignal.timeout(3_000),
      });

      const second = await runtime.complete(
        model(runtime),
        {
          messages: [
            ...context.messages,
            first,
            {
              role: "toolResult",
              toolCallId: "fixture-tool-call-1",
              toolName: "read",
              content: [{ type: "text", text: "fixture file contents" }],
              isError: false,
              timestamp: 2,
            },
          ],
        },
        { maxTokens: 12, maxRetries: 0, signal: AbortSignal.timeout(3_000) },
      );

      expect(second.stopReason).toBe("stop");
      expect((await server.waitForResponseClosed(1)).body).toMatchObject({
        context: {
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", toolCallId: "fixture-tool-call-1" }),
          ]),
        },
        options: { maxTokens: 12 },
      });
      expect(server.requests()).toHaveLength(2);
      expect(server.violations()).toEqual([]);
    },
  );
});

test("ModelRuntime preserves terminal stream errors with partial text and usage", async () => {
  await withProtocol([{ kind: "stream", events: errorEvents }], async (server, runtime) => {
    const stream = runtime.streamSimple(model(runtime), context, {
      maxRetries: 0,
      signal: AbortSignal.timeout(3_000),
    });

    expect(await eventTypes(stream)).toEqual(["start", "text_start", "text_delta", "error"]);
    expect(await stream.result()).toMatchObject({
      stopReason: "error",
      errorMessage: "scripted stream failure",
      content: [{ type: "text", text: "partial" }],
      usage: protocolUsage,
    });
    await server.waitForResponseClosed(0);
    expect(server.requests()).toHaveLength(1);
  });
});

test("native HTTP 429 is an actual SDK error with no additional dispatch", async () => {
  await withProtocol(
    [{ kind: "http-error", status: 429, message: "finite rate limit", code: "rate_limit" }],
    async (server, runtime) => {
      const result = await runtime.complete(model(runtime), context, {
        maxRetries: 0,
        signal: AbortSignal.timeout(3_000),
      });

      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("429");
      expect(result.errorMessage).toContain("finite rate limit");
      await server.waitForResponseClosed(0);
      expect(server.requests()).toHaveLength(1);
      expect(server.violations()).toEqual([]);
    },
  );
});

test("a held response releases only at its explicit barrier, preserving streamed output", async () => {
  await withProtocol(
    [{ kind: "stream", events: textEvents, holdBeforeEvent: 3 }],
    async (server, runtime) => {
      const stream = runtime.stream(model(runtime), context, {
        signal: AbortSignal.timeout(3_000),
        maxRetries: 0,
      });

      const observed = eventTypes(stream);
      expect(await server.waitForHeld(0)).toMatchObject({ state: "held", responseClosed: false });
      server.release(0);
      expect(await observed).toEqual([
        "start",
        "text_start",
        "text_delta",
        "text_delta",
        "text_end",
        "done",
      ]);
      expect((await stream.result()).content).toEqual([
        { type: "text", text: "finite answer", textSignature: undefined },
      ]);
      expect((await server.waitForResponseClosed(0)).state).toBe("sent");
      expect(() => server.release(0)).toThrow("not held");
    },
  );
});

test("actual SDK abort cancels held HTTP and the server observes response closure", async () => {
  await withProtocol(
    [{ kind: "stream", events: textEvents, holdBeforeEvent: 3 }],
    async (server, runtime) => {
      const controller = new AbortController();

      const stream = runtime.stream(model(runtime), context, {
        signal: controller.signal,
        maxRetries: 0,
      });

      await server.waitForHeld(0);
      controller.abort();
      expect((await stream.result()).stopReason).toBe("aborted");
      expect((await server.waitForResponseClosed(0)).state).toBe("cancelled");
      expect(server.requests()).toHaveLength(1);
      expect(server.violations()).toEqual([]);
      expect(await server.close()).toEqual({
        closed: true,
        activeSockets: 0,
        activeResponses: 0,
        unusedSteps: 0,
      });
    },
  );
});

test("unreleased held responses have a finite deadline and fail through the actual SDK", async () => {
  await withProtocol(
    [{ kind: "stream", events: textEvents, holdBeforeEvent: 0, holdTimeoutMs: 150 }],
    async (server, runtime) => {
      const stream = runtime.stream(model(runtime), context, {
        maxRetries: 0,
        signal: AbortSignal.timeout(3_000),
      });

      await server.waitForHeld(0);
      expect((await stream.result()).stopReason).toBe("error");
      expect((await server.waitForResponseClosed(0)).state).toBe("timed-out");
      expect(server.violations()).toEqual(["held response 0 exceeded deadline"]);
    },
  );
});

test("script exhaustion rejects extra HTTP dispatch rather than repeating responses", async () => {
  await withProtocol([{ kind: "stream", events: textEvents }], async (server, runtime) => {
    expect(
      (
        await runtime.completeSimple(model(runtime), context, {
          signal: AbortSignal.timeout(3_000),
        })
      ).stopReason,
    ).toBe("stop");

    const extra = await runtime.completeSimple(model(runtime), context, {
      signal: AbortSignal.timeout(3_000),
      maxRetries: 0,
    });

    expect(extra.stopReason).toBe("error");
    expect(extra.errorMessage).toContain("fixture script exhausted");
    expect((await server.waitForResponseClosed(1)).state).toBe("rejected");
    expect(server.violations()).toEqual(["fixture script exhausted"]);
  });
});

test("fixture auth/route rejection, snapshot isolation, bounded barriers and close are real HTTP behavior", async () => {
  const server = await startModelProtocolServer([{ kind: "stream", events: textEvents }]);

  try {
    const denied = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      body: "{}",
      headers: { authorization: "Bearer not-a-secret" },
    });

    expect(denied.status).toBe(401);
    await denied.text();
    expect((await server.waitForResponseClosed(0)).authenticated).toBe(false);
    const wrongRoute = await fetch(`${server.baseUrl}/unexpected`, { method: "POST", body: "{}" });
    expect(wrongRoute.status).toBe(404);
    await wrongRoute.text();
    const snapshot = server.requests();
    expect(JSON.stringify(snapshot)).not.toContain("not-a-secret");
    expect(JSON.stringify(snapshot)).not.toContain(fixtureApiKey);
    await expect(server.waitForRequest(2, 10)).rejects.toThrow("timed out");
    const missing = server.waitForRequest(2);
    const rejected = expect(missing).rejects.toThrow("closed before request barrier");
    const closed = await server.close();
    await rejected;
    expect(closed).toEqual({ closed: true, activeSockets: 0, activeResponses: 0, unusedSteps: 1 });
    expect(await server.close()).toEqual(closed);
    await expect(
      fetch(`${server.baseUrl}/messages`, { signal: AbortSignal.timeout(1_000) }),
    ).rejects.toThrow();
  } finally {
    await server.close();
  }
});

test("server close drains an active held SDK connection and reports unused script accurately", async () => {
  await withProtocol(
    [
      { kind: "stream", events: textEvents, holdBeforeEvent: 0 },
      { kind: "stream", events: toolEvents },
    ],
    async (server, runtime) => {
      const stream = runtime.streamSimple(model(runtime), context, {
        signal: AbortSignal.timeout(3_000),
      });

      await server.waitForHeld(0);
      expect(await server.close()).toEqual({
        closed: true,
        activeSockets: 0,
        activeResponses: 0,
        unusedSteps: 1,
      });
      expect((await stream.result()).stopReason).toBe("error");
      expect(server.requests()[0]).toMatchObject({ responseClosed: true, state: "cancelled" });
    },
  );
});

test("independent real SDK requests progress while an earlier response is held", async () => {
  await withProtocol(
    [
      { kind: "stream", events: textEvents, holdBeforeEvent: 0 },
      { kind: "stream", events: toolEvents },
    ],
    async (server, runtime) => {
      const controller = new AbortController();
      const first = runtime.streamSimple(model(runtime), context, { signal: controller.signal });
      await server.waitForHeld(0);

      const second = await runtime.completeSimple(model(runtime), context, {
        signal: AbortSignal.timeout(3_000),
        maxRetries: 0,
      });

      expect(second.stopReason).toBe("toolUse");
      expect((await server.waitForResponseClosed(1)).state).toBe("sent");
      expect(server.requests()[0]).toMatchObject({ state: "held", responseClosed: false });
      controller.abort();
      expect((await first.result()).stopReason).toBe("aborted");
      expect((await server.waitForResponseClosed(0)).state).toBe("cancelled");
      expect(server.violations()).toEqual([]);
    },
  );
});

test("the actual native client rejects incorrect auth without leaking its value into logs", async () => {
  await withProtocol([{ kind: "stream", events: textEvents }], async (server, runtime) => {
    const resolved = model(runtime);

    const stream = streamNative(
      { ...resolved, api: "pi-messages", compat: undefined },
      normalizeContext(context),
      {
        apiKey: "incorrect-nonsecret-fixture-key",
        signal: AbortSignal.timeout(3_000),
        maxRetries: 0,
      },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("401");
    expect(await server.waitForResponseClosed(0)).toMatchObject({
      state: "rejected",
      authenticated: false,
    });
    expect(JSON.stringify(server.requests())).not.toContain("incorrect-nonsecret-fixture-key");
    expect(server.violations()).toEqual(["fixture authentication rejected"]);
    expect((await server.close()).unusedSteps).toBe(1);
  });
});

test("invalid or unbounded fixture scripts are rejected before binding a socket", async () => {
  await expect(startModelProtocolServer([])).rejects.toThrow("finite response steps");
  await expect(
    startModelProtocolServer([{ kind: "stream", events: [{ type: "start" }] }]),
  ).rejects.toThrow("terminal done/error");
  await expect(
    startModelProtocolServer([{ kind: "stream", events: textEvents, holdBeforeEvent: 99 }]),
  ).rejects.toThrow("identify an event");
  await expect(
    startModelProtocolServer([{ kind: "stream", events: textEvents, holdTimeoutMs: 0 }]),
  ).rejects.toThrow("between 1 and 120000");
  await expect(
    startModelProtocolServer([{ kind: "http-error", status: 200, message: "bad", code: "bad" }]),
  ).rejects.toThrow("between 400 and 599");
  expect(() => modelProtocolConfig("https://example.invalid")).toThrow("loopback");
});

test("started scripts and returned request snapshots cannot mutate later server behavior", async () => {
  const events = textEvents.map((event) => structuredClone(event));
  const server = await startModelProtocolServer([{ kind: "stream", events }]);

  try {
    events.splice(0, events.length, ...errorEvents);

    const response = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body: JSON.stringify({
        model: fixtureModel,
        context: { messages: [] },
        options: { maxTokens: 12 },
      }),
    });

    const wire = await response.text();
    expect(wire).toContain('"content":"finite answer"');
    expect(wire).not.toContain("scripted stream failure");
    const snapshot = await server.waitForResponseClosed(0);

    if (
      !(snapshot.body instanceof Object) ||
      !("options" in snapshot.body) ||
      !(snapshot.body.options instanceof Object)
    )
      throw new Error("Expected nested fixture options");
    Object.assign(snapshot.body.options, { maxTokens: 999 });
    Object.assign(snapshot, { state: "held" });
    expect(server.requests()[0]).toMatchObject({
      state: "sent",
      body: { options: { maxTokens: 12 } },
    });
    const returned = server.requests();
    const returnedBody = returned[0].body;

    if (
      !(returnedBody instanceof Object) ||
      !("context" in returnedBody) ||
      !(returnedBody.context instanceof Object)
    )
      throw new Error("Expected nested fixture context");
    Object.assign(returnedBody.context, { messages: ["corrupted"] });
    expect((await server.waitForResponseClosed(0)).body).toMatchObject({
      context: { messages: [] },
    });
    expect(server.requests()[0]).toMatchObject({ state: "sent", body: { model: fixtureModel } });
    expect(server.violations()).toEqual([]);
  } finally {
    expect(await server.close()).toEqual({
      closed: true,
      activeSockets: 0,
      activeResponses: 0,
      unusedSteps: 0,
    });
  }
});

function readHttpResponse(request: ClientRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error);
    };

    const deadline = setTimeout(() => {
      const error = new Error("HTTP response deadline exceeded");
      fail(error);
      request.destroy(error);
    }, 2_000);

    request.on("error", fail);
    request.once("close", () => {
      fail(new Error("HTTP request closed before response completed"));
    });
    request.once("response", (response) => {
      let wire = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        wire += chunk;
      });
      response.once("error", fail);
      response.once("close", () => {
        if (!response.complete) fail(new Error("HTTP response closed before completion"));
      });
      response.once("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(wire);
      });
    });
  });
}

test("HTTP arrival reserves indices and scripts before delayed body completion", async () => {
  const server = await startModelProtocolServer([
    { kind: "stream", events: textEvents },
    { kind: "stream", events: toolEvents },
  ]);

  const body = JSON.stringify({ model: fixtureModel, context: { messages: [] }, options: {} });

  const first = httpRequest(`${server.baseUrl}/messages`, {
    method: "POST",
    agent: false,
    headers: {
      authorization: `Bearer ${fixtureApiKey}`,
      "content-length": Buffer.byteLength(body),
    },
  });

  // Attach both outcomes immediately; A may fail while independent B is progressing.
  const firstResponse = readHttpResponse(first).then(
    (wire) => ({ wire }),
    (error: Error) => ({ error }),
  );

  try {
    first.write(body.slice(0, 10));
    expect(await server.waitForRequest(0, 500)).toMatchObject({
      state: "receiving",
      bodyComplete: false,
    });

    const second = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body,
      signal: AbortSignal.timeout(2_000),
    });

    expect(await second.text()).toContain('"reason":"toolUse"');
    expect(await server.waitForResponseClosed(1)).toMatchObject({
      state: "sent",
      bodyComplete: true,
    });
    expect(server.requests()[0]).toMatchObject({ state: "receiving", responseClosed: false });
    first.end(body.slice(10));
    const outcome = await firstResponse;

    if ("error" in outcome) throw outcome.error;
    expect(outcome.wire).toContain('"content":"finite answer"');
    expect(await server.waitForResponseClosed(0)).toMatchObject({
      state: "sent",
      bodyComplete: true,
    });
    expect(server.violations()).toEqual([]);
  } finally {
    first.destroy();
    expect(await server.close()).toMatchObject({
      closed: true,
      activeSockets: 0,
      activeResponses: 0,
    });
  }
});

test("incomplete HTTP headers close within the five-second deadline plus scheduling tolerance", async () => {
  const server = await startModelProtocolServer([{ kind: "stream", events: textEvents }]);
  const socket = connect(Number(new URL(server.baseUrl).port), "127.0.0.1");
  socket.on("error", () => {});
  socket.resume();

  try {
    await once(socket, "connect");
    const started = performance.now();
    const closed = once(socket, "close", { signal: AbortSignal.timeout(6_500) });
    socket.write("POST /messages HTTP/1.1\r\nHost: loopback\r\nX-Partial:");
    await closed;
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(6_500);
    expect(server.requests()).toEqual([]);
  } finally {
    socket.destroy();
    expect(await server.close()).toMatchObject({
      activeSockets: 0,
      activeResponses: 0,
      unusedSteps: 1,
    });
  }
}, 10_000);

test("malformed eligible bodies consume their arrival reservation but rejected routes/auth do not", async () => {
  const server = await startModelProtocolServer([
    { kind: "stream", events: textEvents },
    { kind: "stream", events: toolEvents },
  ]);

  try {
    const wrongRoute = await fetch(`${server.baseUrl}/wrong`, { method: "POST", body: "{}" });
    expect(wrongRoute.status).toBe(404);
    await wrongRoute.text();
    const denied = await fetch(`${server.baseUrl}/messages`, { method: "POST", body: "{}" });
    expect(denied.status).toBe(401);
    await denied.text();

    const malformed = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body: "{bad",
    });

    expect(malformed.status).toBe(400);
    await malformed.text();
    expect(await server.waitForResponseClosed(2)).toMatchObject({
      bodyComplete: true,
      state: "rejected",
      body: undefined,
    });

    const valid = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body: "{}",
    });

    expect(await valid.text()).toContain('"reason":"toolUse"');
    expect(await server.waitForResponseClosed(3)).toMatchObject({
      state: "sent",
      bodyComplete: true,
    });
    expect((await server.close()).unusedSteps).toBe(0);
  } finally {
    await server.close();
  }
});

test("header deadline checking does not terminate a deliberate held SDK response", async () => {
  await withProtocol(
    [{ kind: "stream", events: textEvents, holdBeforeEvent: 0, holdTimeoutMs: 8_000 }],
    async (server, runtime) => {
      const signal = AbortSignal.timeout(5_500);
      const stream = runtime.streamSimple(model(runtime), context, { signal });
      await server.waitForHeld(0);
      expect((await stream.result()).stopReason).toBe("aborted");
      expect(signal.aborted).toBe(true);
      expect(await server.waitForResponseClosed(0)).toMatchObject({ state: "cancelled" });
      expect(server.violations()).toEqual([]);
    },
  );
}, 10_000);

test("setup rejection and callback failure remove their owned temporary directories", async () => {
  const parent = await mkdtemp(join(tmpdir(), "kstack-protocol-cleanup-proof-"));

  try {
    await expect(withProtocol([], async () => {}, parent)).rejects.toThrow("inspect all causes");
    expect(await readdir(parent), `Owned cleanup evidence retained at ${parent}`).toEqual([]);
    const callbackFailure = new Error("intentional callback failure after actual SDK response");
    await expect(
      withProtocol(
        [{ kind: "stream", events: textEvents }],
        async (server, runtime) => {
          expect(
            (
              await runtime.completeSimple(model(runtime), context, {
                signal: AbortSignal.timeout(2_000),
              })
            ).stopReason,
          ).toBe("stop");
          expect(await server.waitForResponseClosed(0)).toMatchObject({ state: "sent" });
          throw callbackFailure;
        },
        parent,
      ),
    ).rejects.toMatchObject({ errors: [callbackFailure] });
    expect(await readdir(parent), `Owned cleanup evidence retained at ${parent}`).toEqual([]);
  } finally {
    // Never erase a retained child whose server cleanup could not be confirmed.
    if ((await readdir(parent)).length === 0) await rm(parent, { recursive: true });
  }
});

test("cancelling a delayed request body closes its response without reusing its reserved script", async () => {
  const server = await startModelProtocolServer([
    { kind: "stream", events: textEvents },
    { kind: "stream", events: toolEvents },
  ]);

  const first = httpRequest(`${server.baseUrl}/messages`, {
    method: "POST",
    agent: false,
    headers: { authorization: `Bearer ${fixtureApiKey}`, "content-length": 100 },
  });

  first.on("error", () => {});

  try {
    first.write("{");
    expect(await server.waitForRequest(0)).toMatchObject({
      state: "receiving",
      bodyComplete: false,
    });
    first.destroy();
    expect(await server.waitForResponseClosed(0)).toMatchObject({
      state: "cancelled",
      bodyComplete: false,
    });

    const second = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body: "{}",
      signal: AbortSignal.timeout(2_000),
    });

    expect(await second.text()).toContain('"reason":"toolUse"');
    expect(await server.waitForResponseClosed(1)).toMatchObject({
      state: "sent",
      bodyComplete: true,
    });
    expect(server.violations()).toEqual([]);
  } finally {
    first.destroy();
    expect(await server.close()).toMatchObject({
      activeSockets: 0,
      activeResponses: 0,
      unusedSteps: 0,
    });
  }
});

test("a pre-response request cancellation promptly rejects while another HTTP request progresses", async () => {
  const server = await startModelProtocolServer([
    { kind: "stream", events: textEvents },
    { kind: "stream", events: toolEvents },
  ]);

  const first = httpRequest(`${server.baseUrl}/messages`, {
    method: "POST",
    agent: false,
    headers: { authorization: `Bearer ${fixtureApiKey}`, "content-length": 100 },
  });

  // Observe rejection immediately, before admission or independent B progress.
  const observed = readHttpResponse(first).then(
    (wire) => ({ wire }),
    (error: Error) => ({ error }),
  );

  let watchdog: ReturnType<typeof setTimeout> | undefined;

  try {
    first.write("{");
    await server.waitForRequest(0);
    first.destroy();

    const second = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureApiKey}` },
      body: "{}",
      signal: AbortSignal.timeout(2_000),
    });

    expect(await second.text()).toContain('"reason":"toolUse"');

    const outcome = await Promise.race([
      observed,
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("Pre-response rejection did not settle promptly")),
          500,
        );
      }),
    ]);

    if (!("error" in outcome))
      throw new Error("Cancelled request unexpectedly produced a response");
    expect(outcome.error.message).toContain("socket hang up");
    expect(await server.waitForResponseClosed(0)).toMatchObject({
      state: "cancelled",
      bodyComplete: false,
    });
    expect(await server.waitForResponseClosed(1)).toMatchObject({ state: "sent" });
  } finally {
    if (watchdog) clearTimeout(watchdog);
    first.destroy();
    expect(await server.close()).toMatchObject({
      closed: true,
      activeSockets: 0,
      activeResponses: 0,
    });
  }
});

test("the explicit request deadline rejects and destroys a still-incomplete owned request", async () => {
  const server = await startModelProtocolServer([{ kind: "stream", events: textEvents }]);

  const first = httpRequest(`${server.baseUrl}/messages`, {
    method: "POST",
    agent: false,
    headers: { authorization: `Bearer ${fixtureApiKey}`, "content-length": 100 },
  });

  const observed = readHttpResponse(first).then(
    (wire) => ({ wire }),
    (error: Error) => ({ error }),
  );

  let watchdog: ReturnType<typeof setTimeout> | undefined;

  try {
    first.write("{");
    expect(await server.waitForRequest(0)).toMatchObject({
      state: "receiving",
      bodyComplete: false,
    });

    const outcome = await Promise.race([
      observed,
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("Owned request deadline did not settle response")),
          3_000,
        );
      }),
    ]);

    if (!("error" in outcome))
      throw new Error("Incomplete request unexpectedly produced a response");
    expect(outcome.error.message).toBe("HTTP response deadline exceeded");
    expect(first.destroyed).toBe(true);
    expect(await server.waitForResponseClosed(0)).toMatchObject({
      state: "cancelled",
      bodyComplete: false,
    });
    expect(server.violations()).toEqual([]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
    first.destroy();
    expect(await server.close()).toMatchObject({
      closed: true,
      activeSockets: 0,
      activeResponses: 0,
    });
  }
});
