import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import type { PiMessagesEvent } from "@earendil-works/pi-ai/api/pi-messages";

export const fixtureApiKey = "kstack-loopback-nonsecret-fixture-key";

export const fixtureProvider = "kstack-protocol-fixture";

export const fixtureModel = "scripted-native-model";

export type ProtocolStep =
  | {
      kind: "stream";
      events: readonly PiMessagesEvent[];
      /** Pause before this event (0 also permits holding before generation starts). */
      holdBeforeEvent?: number;
      holdTimeoutMs?: number;
    }
  | { kind: "http-error"; status: number; message: string; code: string };

export interface ProtocolRequest {
  readonly index: number;
  readonly method: string;
  readonly path: string;
  readonly authenticated: boolean;
  readonly body: unknown;
  readonly bodyComplete: boolean;
  readonly state:
    | "receiving"
    | "received"
    | "held"
    | "sent"
    | "cancelled"
    | "timed-out"
    | "rejected";
  readonly responseClosed: boolean;
}

type MutableRequest = { -readonly [K in keyof ProtocolRequest]: ProtocolRequest[K] };

export interface ProtocolCloseResult {
  closed: true;
  activeSockets: 0;
  activeResponses: 0;
  unusedSteps: number;
}

export interface ModelProtocolServer {
  readonly baseUrl: string;
  /** Detached body/state snapshots; request headers and their auth values are never retained. */
  requests(): readonly ProtocolRequest[];
  violations(): readonly string[];
  waitForRequest(index: number, timeoutMs?: number): Promise<ProtocolRequest>;
  waitForHeld(index: number, timeoutMs?: number): Promise<ProtocolRequest>;
  waitForResponseClosed(index: number, timeoutMs?: number): Promise<ProtocolRequest>;
  release(index: number): void;
  close(): Promise<ProtocolCloseResult>;
}

const maxBodyBytes = 1024 * 1024;

const maxSteps = 128;

function boundedTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new Error("Fixture timeout must be an integer between 1 and 120000 ms");
  }

  return value;
}

/** Only the remote pi-messages service is scripted; callers use real SDK transports. */
export async function startModelProtocolServer(
  inputSteps: readonly ProtocolStep[],
): Promise<ModelProtocolServer> {
  if (inputSteps.length === 0 || inputSteps.length > maxSteps) {
    throw new Error("Fixture requires between 1 and 128 finite response steps");
  }

  const steps = structuredClone(inputSteps);

  for (const step of steps) {
    if (step.kind === "stream") {
      if (step.events.length === 0 || step.events.length > 1024) {
        throw new Error("Fixture stream requires between 1 and 1024 events");
      }

      const terminal = step.events.at(-1)?.type;

      if (terminal !== "done" && terminal !== "error") {
        throw new Error("Fixture stream requires a terminal done/error event");
      }

      if (
        step.holdBeforeEvent !== undefined &&
        (!Number.isInteger(step.holdBeforeEvent) ||
          step.holdBeforeEvent < 0 ||
          step.holdBeforeEvent >= step.events.length)
      ) {
        throw new Error("Fixture hold must identify an event in the finite stream");
      }

      boundedTimeout(step.holdTimeoutMs ?? 5_000);
    } else if (!Number.isInteger(step.status) || step.status < 400 || step.status > 599) {
      throw new Error("Fixture HTTP error status must be between 400 and 599");
    }
  }

  const requests: MutableRequest[] = [];
  const violations: string[] = [];
  const sockets = new Set<Socket>();
  const responses = new Set<ServerResponse>();
  const listeners = new Set<() => void>();
  const releases = new Map<number, () => void>();
  let consumed = 0;
  let closing = false;
  let closePromise: Promise<ProtocolCloseResult> | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const server = createServer({ connectionsCheckingInterval: 50 }, (request, response) => {
    responses.add(response);
    request.on("error", () => response.destroy());

    const entry: MutableRequest = {
      index: requests.length,
      method: request.method ?? "",
      path: request.url ?? "",
      authenticated: request.headers.authorization === `Bearer ${fixtureApiKey}`,
      body: undefined,
      bodyComplete: false,
      state: "receiving",
      responseClosed: false,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (timer) clearTimeout(timer);
      responses.delete(response);

      entry.responseClosed = true;

      if (!response.writableFinished && entry.state !== "timed-out") entry.state = "cancelled";
      releases.delete(entry.index);

      notify();
    };

    response.once("close", finish);

    const reject = (status: number, message: string) => {
      entry.state = "rejected";
      violations.push(message);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message, code: "fixture_rejected" } }));
      request.resume();
      notify();
    };

    if (requests.length >= maxSteps + 1) {
      reject(429, "fixture request limit exceeded");

      return;
    }

    requests.push(entry);
    notify();

    if (entry.method !== "POST" || entry.path !== "/messages") {
      reject(404, "unexpected fixture route");

      return;
    }

    if (!entry.authenticated) {
      reject(401, "fixture authentication rejected");

      return;
    }

    const step = steps[consumed++];

    if (!step) {
      reject(409, "fixture script exhausted");

      return;
    }

    timer = setTimeout(() => {
      entry.state = "timed-out";
      violations.push("request body deadline exceeded");
      response.destroy();
    }, 5_000);
    let body = "";
    let bytes = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);

      if (bytes > maxBodyBytes) {
        response.destroy();
        violations.push("request body limit exceeded");
      } else body += chunk;
    });
    request.on("end", () => {
      if (response.destroyed) return;

      if (timer) clearTimeout(timer);
      entry.bodyComplete = true;
      let parsed: unknown;

      try {
        parsed = JSON.parse(body);
      } catch {
        reject(400, "invalid JSON request");

        return;
      }

      entry.body = parsed;
      entry.state = "received";
      notify();

      if (step.kind === "http-error") {
        response.writeHead(step.status, { "content-type": "application/json" });
        entry.state = "sent";
        response.end(JSON.stringify({ error: { message: step.message, code: step.code } }));
        notify();

        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(": fixture connected\n\n");
      const current = entry;
      let nextEvent = 0;

      const send = () => {
        if (response.destroyed || closing) return;

        while (nextEvent < step.events.length) {
          if (nextEvent === step.holdBeforeEvent && current.state !== "held") {
            current.state = "held";
            timer = setTimeout(() => {
              current.state = "timed-out";
              violations.push(`held response ${current.index} exceeded deadline`);
              releases.delete(current.index);
              response.destroy();
              notify();
            }, step.holdTimeoutMs ?? 5_000);
            releases.set(current.index, () => {
              if (timer) clearTimeout(timer);
              releases.delete(current.index);
              send();
            });
            notify();

            return;
          }

          response.write(`data: ${JSON.stringify(step.events[nextEvent++])}\n\n`);
        }

        current.state = "sent";
        response.end();
        notify();
      };

      send();
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      notify();
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();

  if (
    !address ||
    !(address instanceof Object) ||
    address.family !== "IPv4" ||
    address.address !== "127.0.0.1"
  )
    throw new Error("Fixture did not bind IPv4 loopback TCP");

  function waitFor(
    index: number,
    predicate: (entry: ProtocolRequest) => boolean,
    timeoutMs = 5_000,
  ): Promise<ProtocolRequest> {
    boundedTimeout(timeoutMs);

    if (!Number.isInteger(index) || index < 0 || index > maxSteps) {
      return Promise.reject(new Error("Invalid fixture request index"));
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        listeners.delete(check);
      };

      const check = () => {
        const entry = requests[index];

        if (entry && predicate(entry)) {
          cleanup();
          resolve(structuredClone(entry));
        } else if (closing) {
          cleanup();
          reject(new Error(`Fixture closed before request barrier ${index}`));
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Fixture request barrier ${index} timed out`));
      }, timeoutMs);

      listeners.add(check);
      check();
    });
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: () => structuredClone(requests),
    violations: () => [...violations],
    waitForRequest: (index, timeoutMs) => waitFor(index, () => true, timeoutMs),
    waitForHeld: (index, timeoutMs) => waitFor(index, (entry) => entry.state === "held", timeoutMs),
    waitForResponseClosed: (index, timeoutMs) =>
      waitFor(index, (entry) => entry.responseClosed, timeoutMs),
    release(index) {
      const release = releases.get(index);

      if (!release || closing) throw new Error(`Fixture response ${index} is not held`);
      release();
    },
    close() {
      closePromise ??= (async () => {
        closing = true;
        notify();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            listeners.delete(check);
            reject(new Error("Fixture socket/server cleanup deadline exceeded"));
          }, 5_000);

          let serverClosed = false;

          const check = () => {
            if (serverClosed && sockets.size === 0 && responses.size === 0) {
              clearTimeout(timeout);
              listeners.delete(check);
              resolve();
            }
          };

          listeners.add(check);
          server.close(() => {
            serverClosed = true;
            check();
          });

          for (const response of responses) response.destroy();

          for (const socket of sockets) socket.destroy();
        });

        return {
          closed: true,
          activeSockets: 0,
          activeResponses: 0,
          unusedSteps: Math.max(0, steps.length - consumed),
        } satisfies ProtocolCloseResult;
      })();

      return closePromise;
    },
  };
}

/** Normal custom-provider configuration; no fixture-specific runtime/CLI option. */
export function modelProtocolConfig(baseUrl: string) {
  const url = new URL(baseUrl);

  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    baseUrl !== url.origin
  ) {
    throw new Error("Fixture models must use explicit IPv4 loopback HTTP");
  }

  return {
    providers: {
      [fixtureProvider]: {
        api: "pi-messages",
        baseUrl,
        apiKey: fixtureApiKey,
        models: [
          {
            id: fixtureModel,
            name: "Finite loopback fixture",
            reasoning: false,
            input: ["text"],
            contextWindow: 32_768,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
}
