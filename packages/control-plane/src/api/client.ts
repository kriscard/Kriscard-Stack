import type { CommandEvent, CommandRecord } from "../runtime/commands.js";
import type {
  PlanningCommandRequest,
  PlanningEvent,
  PlanningRun,
} from "../runtime/planning.js";
import { API_VERSION } from "./protocol.js";

const MAX_EVENT_FRAME_CHARS = 1024 * 1024;

export class ControlPlaneApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Control-plane API ${status}: ${code}`);
  }
}

/** The CLI, Pi, and Claude adapters all use this transport rather than reading SQLite. */
export function createControlPlaneClient(options: {
  url: string;
  deviceId: string;
  credential: string;
  fetch?: typeof fetch;
}) {
  const base = new URL(options.url);
  const loopback =
    base.protocol === "http:" &&
    (base.hostname === "127.0.0.1" || base.hostname === "[::1]");
  const tailnet =
    base.protocol === "https:" && base.hostname.endsWith(".ts.net");
  if ((!loopback && !tailnet) || base.username || base.password)
    throw new Error(
      "The control-plane client requires loopback or private Tailscale HTTPS",
    );
  const transport = options.fetch ?? fetch;
  const headers = {
    "X-Kriscard-Api-Version": String(API_VERSION),
    "X-Kriscard-Device-Id": options.deviceId,
    Authorization: `Bearer ${options.credential}`,
  };

  async function request(
    route: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await transport(new URL(`/v1/${route}`, base), {
      ...init,
      headers: { ...headers, ...init.headers },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      let code = "UNKNOWN_ERROR";
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === "string") code = payload.error;
      } catch {
        /* An invalid error response is still a failed request. */
      }
      throw new ControlPlaneApiError(response.status, code);
    }
    if (response.headers.get("x-kriscard-api-version") !== String(API_VERSION))
      throw new ControlPlaneApiError(426, "INCOMPATIBLE_VERSION");
    return response;
  }

  async function* eventStream<Event extends { position: number }>(
    route: string,
    eventType: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Event> {
    const response = await request(route, signal ? { signal } : {});
    if (!response.body)
      throw new ControlPlaneApiError(502, "MISSING_EVENT_STREAM");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          if (end > MAX_EVENT_FRAME_CHARS)
            throw new ControlPlaneApiError(502, "EVENT_TOO_LARGE");
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = frame
            .split("\n")
            .find((line) => line.startsWith("event: "))
            ?.slice(7);
          if (type === "reset")
            throw new ControlPlaneApiError(410, "EXPIRED_POSITION");
          if (type !== eventType) continue;
          const id = frame
            .split("\n")
            .find((line) => line.startsWith("id: "))
            ?.slice(4);
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (!id || !data)
            throw new ControlPlaneApiError(502, "INVALID_EVENT");
          const event = JSON.parse(data) as Event;
          if (
            event.position !== Number(id) ||
            !Number.isSafeInteger(event.position)
          )
            throw new ControlPlaneApiError(502, "INVALID_EVENT");
          yield event;
        }
        if (buffer.length > MAX_EVENT_FRAME_CHARS)
          throw new ControlPlaneApiError(502, "EVENT_TOO_LARGE");
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  return {
    async health(): Promise<{ status: string; apiVersion: number }> {
      return (await (await request("health")).json()) as {
        status: string;
        apiVersion: number;
      };
    },
    async state(): Promise<{
      version: number;
      commands: Record<string, CommandRecord>;
    }> {
      return (await (await request("state")).json()) as {
        version: number;
        commands: Record<string, CommandRecord>;
      };
    },
    async command(key: string): Promise<CommandRecord> {
      return (await (
        await request(`commands?key=${encodeURIComponent(key)}`)
      ).json()) as CommandRecord;
    },
    async submit(input: {
      key: string;
      operation: string;
      expectedVersion: number;
    }): Promise<{
      taskId: number;
      version: number;
    }> {
      return (await (
        await request("commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).json()) as { taskId: number; version: number };
    },
    /** Resume from the last acknowledged event ID; an expired ID requires a new state snapshot. */
    events(after: number, signal?: AbortSignal): AsyncGenerator<CommandEvent> {
      return eventStream<CommandEvent>(
        `events?after=${after}`,
        "command",
        signal,
      );
    },
    async planningState(): Promise<{
      version: number;
      runs: Record<string, PlanningRun>;
    }> {
      return (await (await request("planning/state")).json()) as {
        version: number;
        runs: Record<string, PlanningRun>;
      };
    },
    async planningRun(revisionId: string): Promise<PlanningRun> {
      return (await (
        await request(
          `planning/runs?revisionId=${encodeURIComponent(revisionId)}`,
        )
      ).json()) as PlanningRun;
    },
    async submitPlanning(
      input: PlanningCommandRequest,
    ): Promise<{ version: number; taskId?: number }> {
      return (await (
        await request("planning/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).json()) as { version: number; taskId?: number };
    },
    planningEvents(
      after: number,
      signal?: AbortSignal,
    ): AsyncGenerator<PlanningEvent> {
      return eventStream<PlanningEvent>(
        `planning/events?after=${after}`,
        "planning",
        signal,
      );
    },
    /** Artifacts are addressed by opaque IDs and streamed rather than embedded in events. */
    async artifact(opaqueId: string): Promise<Response> {
      return request(`artifacts/${encodeURIComponent(opaqueId)}`);
    },
  };
}
