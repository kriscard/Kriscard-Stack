import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { cleanupSessionResources } from "@earendil-works/pi-ai";
import { watchEvents } from "@earendil-works/pi-durable";

import { context, openSession, settle, type SessionOptions } from "./session.js";

export type DurableOptions = SessionOptions & {
  prompt?: string;
  print: boolean;
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
  error: Writable;
};

export async function runDurable(options: DurableOptions): Promise<number> {
  // Attach the iterator before opening storage, so early piped input and EOF aren't lost.
  const readline = createInterface({
    input: options.input,
    output: options.output,
    terminal: Boolean(options.input.isTTY && options.output.isTTY),
  });

  const lines = readline[Symbol.asyncIterator]();

  const session = await openSession(options).catch((error) => {
    readline.close();
    throw error;
  });

  const fail = (error: Error) => options.error.write(`${error.message}\n`);

  const interrupt = () => {
    session.root.abort(context).catch(fail);
  };

  readline.on("SIGINT", interrupt);
  const events = await watchEvents(session.harness, session.root.id, context);

  events.start(async (batch) => {
    for (const event of batch) {
      if (event.type !== "message_end") continue;
      const message = event.entry.model?.[0];

      if (message?.role !== "assistant") continue;

      for (const part of message.content) {
        if (part.type === "text") options.output.write(`${part.text}\n`);

        if (part.type === "toolCall" && !options.print) options.output.write(`[${part.name}]\n`);
      }
    }
  });

  try {
    if (!options.print) {
      options.output.write(
        `Pi Durable backend · ${session.root.id}\n:quit pauses · :stop aborts all · :compact summarizes · Ctrl+C aborts the backend turn\n`,
      );
    }

    session.harness.resume();

    if (options.prompt) {
      await session.root.submit({ type: "input", content: options.prompt }, context);
    }

    if (!options.print) {
      for await (const line of lines) {
        const text = line.trim();

        if (!text) continue;

        if (text === ":quit") return 0;

        if (text === ":stop") {
          await session.root.abort(context, { background: true });
          options.output.write("Stopped all work. Conversations retained.\n");
        } else if (text === ":compact") {
          await session.root.compact(undefined, context);
        } else {
          await session.root.submit({ type: "input", content: text, whenBusy: "steer" }, context);
        }
      }
    }

    await settle(session);
    const transcript = await session.root.context(context);

    const failed = [...transcript.messages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (failed?.role === "assistant" && failed.stopReason === "error") {
      options.error.write(`${failed.errorMessage ?? "Model request failed"}\n`);

      return 1;
    }

    return 0;
  } finally {
    readline.off("SIGINT", interrupt);
    readline.close();
    events.stop();

    try {
      await session.close();
    } finally {
      // This CLI process owns its provider transports; release them as native Pi does on disposal.
      cleanupSessionResources();
    }
  }
}
