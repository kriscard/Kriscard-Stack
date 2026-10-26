import { fork } from "node:child_process";
import { once } from "node:events";
import { closeSync, constants, openSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { flockSync } from "fs-ext";

const [mode, path] = process.argv.slice(2);

if (mode === "descendant") {
  process.on("message", (message) => {
    if (message === "ping") process.send?.("alive");
  });
  process.on("disconnect", () => process.exit(0));
  process.send?.("ready");
} else {
  if (!path) throw new Error("A lock path is required");

  let descriptor = openSync(path, constants.O_CREAT | constants.O_RDWR, 0o600);

  if (mode === "probe") {
    let blocked = false;

    try {
      flockSync(descriptor, "exnb");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")
      ) {
        blocked = true;
      } else {
        throw error;
      }
    }

    closeSync(descriptor);
    console.log(blocked ? "blocked" : "acquired");
    process.exitCode = blocked ? 2 : 0;
  } else {
    flockSync(descriptor, "exnb");

    const descendant =
      mode === "hold-with-child" || mode === "hold-with-inherited-child"
        ? fork(fileURLToPath(import.meta.url), ["descendant"], {
            stdio:
              mode === "hold-with-inherited-child"
                ? ["ignore", "ignore", "inherit", "ipc", descriptor]
                : ["ignore", "ignore", "inherit", "ipc"],
          })
        : undefined;

    if (descendant) {
      const [message] = await once(descendant, "message");

      if (message !== "ready") throw new Error("Descendant did not acknowledge startup");
    }

    console.log("held");
    const input = createInterface({ input: process.stdin });

    input.on("line", async (line) => {
      if (line !== "close-lock" || !descendant) {
        throw new Error("Unsupported fixture control");
      }

      closeSync(descriptor);
      descriptor = undefined;
      const reply = once(descendant, "message");
      descendant.send("ping");
      const [message] = await reply;

      if (message !== "alive") throw new Error("Descendant did not acknowledge liveness");
      console.log("descendant-alive");
    });

    input.on("close", async () => {
      if (descendant && descendant.exitCode === null && descendant.signalCode === null) {
        const exited = once(descendant, "exit");
        descendant.kill("SIGTERM");
        await exited;
      }

      if (descriptor !== undefined) closeSync(descriptor);
    });
  }
}
