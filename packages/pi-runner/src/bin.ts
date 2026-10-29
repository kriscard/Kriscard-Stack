#!/usr/bin/env node

import { spawn } from "node:child_process";

import { main, parseCommand, updateTerminal, type CliCommand } from "./cli.js";

async function launch(): Promise<number> {
  const args = process.argv.slice(2);
  let command: CliCommand;

  try {
    command = parseCommand(args);
  } catch {
    return main(args);
  }

  const nativeUpdate =
    command.type === "update" &&
    !command.plain &&
    !command.verbose &&
    process.allowedNodeEnvironmentFlags.has("--experimental-ffi") &&
    updateTerminal(process.stdin, process.stdout);

  if (!nativeUpdate || process.execArgv.includes("--experimental-ffi")) return main(args);

  const child = spawn(
    process.execPath,
    [...process.execArgv, "--experimental-ffi", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );

  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);

  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)),
      );
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

try {
  process.exitCode = await launch();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
