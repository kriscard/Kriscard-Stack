import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { StaleCommandVersionError } from "../runtime/commands.js";
import {
  ExpiredEventPositionError,
  type OpenControlPlane,
} from "../runtime/open.js";
import { API_VERSION } from "./protocol.js";
const MAX_BODY_BYTES = 16 * 1024;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{16,128}$/;

type Artifact = {
  mediaType?: string;
  bytes: AsyncIterable<Uint8Array>;
};

export interface ApiServerOptions {
  runtime: OpenControlPlane;
  /** Credentials are resolved by the host from a secret store; never written to SQLite or a repository. */
  deviceCredentials: Readonly<Record<string, string>>;
  artifact?: (opaqueId: string) => Promise<Artifact | undefined>;
  host?: string;
  port?: number;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Kriscard-Api-Version": String(API_VERSION),
  });
  response.end(bytes);
}

function position(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new ApiError(400, "INVALID_POSITION", "Invalid event position");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new ApiError(400, "INVALID_POSITION", "Invalid event position");
  return parsed;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected JSON");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES)
      throw new ApiError(413, "BODY_TOO_LARGE", "Command body is too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Invalid JSON body");
  }
}

function commandRequest(value: unknown): {
  key: string;
  operation: string;
  expectedVersion: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ApiError(400, "INVALID_COMMAND", "Invalid command body");
  const input = value as Record<string, unknown>;
  if (
    typeof input.key !== "string" ||
    !input.key ||
    input.key.length > 256 ||
    typeof input.operation !== "string" ||
    !input.operation ||
    input.operation.length > 256 ||
    typeof input.expectedVersion !== "number" ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    throw new ApiError(400, "INVALID_COMMAND", "Invalid command body");
  }
  return {
    key: input.key,
    operation: input.operation,
    expectedVersion: input.expectedVersion,
  };
}

async function writeFrame(
  response: ServerResponse,
  frame: string | Buffer,
): Promise<void> {
  if (response.destroyed || response.writableEnded || response.write(frame))
    return;
  await new Promise<void>((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      resolve();
    };
    response.once("drain", done);
    response.once("close", done);
  });
}

/** A single loopback-only transport for every local and Tailscale Serve client. */
export async function startApiServer(options: ApiServerOptions): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1")
    throw new Error("The control-plane API can only bind to a loopback IP");
  const credentials = new Map<string, Buffer>();
  for (const [deviceId, secret] of Object.entries(options.deviceCredentials)) {
    if (
      !DEVICE_ID.test(deviceId) ||
      typeof secret !== "string" ||
      secret.length < 32
    )
      throw new Error("Each device needs an ID and a strong credential");
    credentials.set(deviceId, Buffer.from(secret));
  }
  if (credentials.size === 0)
    throw new Error("At least one device credential is required");

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof ApiError)
        sendJson(response, error.status, {
          error: error.code,
          message: error.message,
        });
      else if (error instanceof StaleCommandVersionError)
        sendJson(response, 409, { error: "STALE_VERSION" });
      else if (error instanceof ExpiredEventPositionError)
        sendJson(response, 410, { error: "EXPIRED_POSITION" });
      else if (error instanceof RangeError)
        sendJson(response, 400, { error: "INVALID_POSITION" });
      else if (error instanceof Error && /Idempotency key/.test(error.message))
        sendJson(response, 409, { error: "KEY_CONFLICT" });
      else if (
        error instanceof Error &&
        /Unsupported command operation/.test(error.message)
      )
        sendJson(response, 422, { error: "UNSUPPORTED_OPERATION" });
      else if (
        error instanceof Error &&
        /No command adapter/.test(error.message)
      )
        sendJson(response, 503, { error: "ADAPTER_UNAVAILABLE" });
      else sendJson(response, 500, { error: "INTERNAL_ERROR" });
    });
  });
  server.requestTimeout = 15_000;

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const deviceId = request.headers["x-kriscard-device-id"];
    const authorization = request.headers.authorization;
    const expected =
      typeof deviceId === "string" ? credentials.get(deviceId) : undefined;
    const supplied = authorization?.startsWith("Bearer ")
      ? Buffer.from(authorization.slice(7))
      : undefined;
    if (
      !expected ||
      !supplied ||
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid device credential");
    }
    if (request.headers["x-kriscard-api-version"] !== String(API_VERSION))
      throw new ApiError(426, "VERSION_REQUIRED", "Supported API version: 1");
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (!url.pathname.startsWith("/v1/"))
      throw new ApiError(404, "NOT_FOUND", "Unknown API route");

    if (request.method === "GET" && url.pathname === "/v1/health") {
      await options.runtime.state();
      sendJson(response, 200, { status: "ok", apiVersion: API_VERSION });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/state") {
      sendJson(response, 200, await options.runtime.state());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/commands") {
      const { key, operation, expectedVersion } = commandRequest(
        await readJson(request),
      );
      const result = await options.runtime.submitVersioned(
        { key, operation },
        expectedVersion,
      );
      sendJson(response, 202, result);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/commands") {
      const key = url.searchParams.get("key");
      if (!key) throw new ApiError(400, "INVALID_KEY", "Missing command key");
      const command = await options.runtime.command(key);
      if (!command) throw new ApiError(404, "NOT_FOUND", "Unknown command");
      sendJson(response, 200, command);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      const lastId = request.headers["last-event-id"];
      if (lastId !== undefined && typeof lastId !== "string")
        throw new ApiError(400, "INVALID_POSITION", "Invalid event position");
      const cursor = position(lastId ?? url.searchParams.get("after") ?? "0");
      const initial = await options.runtime.eventsAfter(cursor);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Kriscard-Api-Version": String(API_VERSION),
      });
      let current = cursor;
      let closed = false;
      response.on("close", () => {
        closed = true;
      });
      let page = initial;
      while (!closed) {
        for (const event of page.events) {
          await writeFrame(
            response,
            `id: ${event.position}\nevent: command\ndata: ${JSON.stringify(event)}\n\n`,
          );
          current = event.position;
          if (closed) break;
        }
        if (closed) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        if (closed) break;
        try {
          page = await options.runtime.eventsAfter(current);
        } catch (error) {
          if (!(error instanceof ExpiredEventPositionError)) throw error;
          await writeFrame(
            response,
            'event: reset\ndata: {"reason":"EXPIRED_POSITION"}\n\n',
          );
          break;
        }
      }
      if (!response.writableEnded) response.end();
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/artifacts/")) {
      const id = url.pathname.slice("/v1/artifacts/".length);
      if (!ARTIFACT_ID.test(id))
        throw new ApiError(400, "INVALID_ARTIFACT_ID", "Invalid artifact ID");
      const artifact = await options.artifact?.(id);
      if (!artifact) throw new ApiError(404, "NOT_FOUND", "Unknown artifact");
      response.writeHead(200, {
        "Content-Type": artifact.mediaType ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Kriscard-Api-Version": String(API_VERSION),
      });
      for await (const chunk of artifact.bytes) {
        if (response.destroyed) break;
        await writeFrame(response, Buffer.from(chunk));
      }
      response.end();
      return;
    }
    throw new ApiError(404, "NOT_FOUND", "Unknown API route");
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP address");
  const displayHost = host === "::1" ? "[::1]" : host;
  let closed = false;
  return {
    url: `http://${displayHost}:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
