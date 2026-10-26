import { Readable, Writable } from "node:stream";

import { expect, test, vi } from "vitest";

import { main, parseCommand } from "../src/cli.js";
import type { CommandRunner } from "../src/installer.js";
import type { PiRunner } from "../src/launcher.js";
import type { DurableOptions } from "../src/durable/terminal.js";

const MODE_PATH = "/skills/kriscard-mode";

type OutputBuffer = {
  stream: Writable;
  read: () => string;
};

function outputBuffer(): OutputBuffer {
  let contents = "";

  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        contents += chunk.toString();
        callback();
      },
    }),
    read: () => contents,
  };
}

test("routes requests to Durable and preserves explicit native Pi access", () => {
  expect(parseCommand([])).toMatchObject({
    type: "durable",
    sessionPath: ".kstack/session.sqlite",
    print: false,
  });
  expect(parseCommand(["pi", "--continue"])).toEqual({
    type: "pi",
    arguments: ["--continue"],
    print: false,
  });
  expect(parseCommand(["run", "Build", "it"])).toMatchObject({
    type: "durable",
    prompt: "Build it",
    print: true,
  });
  expect(parseCommand(["--session", "other.sqlite", "--model", "provider/model"])).toMatchObject({
    type: "durable",
    sessionPath: "other.sqlite",
    model: "provider/model",
  });
  expect(() => parseCommand(["--session"])).toThrow("requires a value");
  expect(() => parseCommand(["run"])).toThrow("requires a request");
  expect(parseCommand(["setup", "--yes"])).toEqual({ type: "setup", yes: true });
  expect(parseCommand(["update"])).toEqual({ type: "update", yes: false });
});

test("opens native Pi with Kriscard mode", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const runPi = vi.fn<PiRunner>(async () => 0);

  await expect(
    main(["pi"], {
      cwd: "/tmp/project",
      input: Readable.from([]),
      output: output.stream,
      error: error.stream,
      modePath: MODE_PATH,
      runPi,
    }),
  ).resolves.toBe(0);

  expect(runPi).toHaveBeenCalledWith(
    expect.arrayContaining(["--skill", MODE_PATH, "--append-system-prompt"]),
    "/tmp/project",
  );
  expect(error.read()).toBe("");
});

test("runs one-shot requests through Pi Durable", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const runDurable = vi.fn<(options: DurableOptions) => Promise<number>>(async () => 0);

  await expect(
    main(["run", "Build", "it"], {
      cwd: "/tmp/project",
      input: Readable.from([]),
      output: output.stream,
      error: error.stream,
      modePath: MODE_PATH,
      runDurable,
    }),
  ).resolves.toBe(0);

  expect(runDurable).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "/tmp/project", prompt: "Build it", print: true }),
  );
  expect(error.read()).toBe("");
});

test("cancels setup before any global mutation", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const calls: string[][] = [];

  const runner: CommandRunner = vi.fn(async (command, args) => {
    calls.push([command, ...args]);

    if (command === "herdr") return { code: 1, stdout: "", stderr: "" };

    if (args.includes("--list")) {
      const source = args[args.indexOf("add") + 1];

      const names =
        source === "kriscard/Skills"
          ? ["debug"]
          : source === "kriscard/Kriscard-Stack"
            ? ["kriscard-mode"]
            : ["herdr"];

      return {
        code: 0,
        stdout: `◇  Available Skills\n${names.map((name) => `│    ${name}`).join("\n")}`,
        stderr: "",
      };
    }

    if (args.includes("list")) {
      return { code: 0, stdout: "[]", stderr: "" };
    }

    throw new Error(`Unexpected mutation: ${command} ${args.join(" ")}`);
  });

  await expect(
    main(["setup"], {
      input: Readable.from(["n\n"]),
      output: output.stream,
      error: error.stream,
      commandRunner: runner,
    }),
  ).resolves.toBe(0);

  expect(output.read()).toContain("Cancelled.");
  expect(error.read()).toBe("");
  expect(calls.some(([command]) => command === "npm")).toBe(false);
});

test("previews and applies only the trusted setup commands", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const calls: string[][] = [];

  const runner: CommandRunner = vi.fn(async (command, args) => {
    calls.push([command, ...args]);

    if (command === "herdr") return { code: 1, stdout: "", stderr: "" };

    if (args.includes("--list")) {
      const source = args[args.indexOf("add") + 1];

      const names =
        source === "kriscard/Skills"
          ? ["debug", "test"]
          : source === "kriscard/Kriscard-Stack"
            ? ["kriscard-mode"]
            : ["herdr"];

      return {
        code: 0,
        stdout: `◇  Available Skills\n${names.map((name) => `│    ${name}`).join("\n")}`,
        stderr: "",
      };
    }

    if (args.includes("list")) {
      return {
        code: 0,
        stdout: JSON.stringify([
          { name: "debug", source: "kriscard/Skills", agents: ["Pi"] },
          { name: "test", source: "kriscard/Skills", agents: ["Pi"] },
          {
            name: "kriscard-mode",
            source: "kriscard/Kriscard-Stack",
            agents: ["Pi"],
          },
          { name: "herdr", source: "herdrdev/herdr", agents: ["Pi"] },
        ]),
        stderr: "",
      };
    }

    return { code: 0, stdout: "", stderr: "" };
  });

  await expect(
    main(["setup", "--yes"], {
      input: Readable.from([]),
      output: output.stream,
      error: error.stream,
      commandRunner: runner,
    }),
  ).resolves.toBe(0);

  expect(output.read()).toContain("Global Pi skills (3");
  expect(output.read()).toContain("Unrelated installed skills will not be removed");
  expect(output.read()).toContain("Setup complete");
  expect(error.read()).toBe("");
  expect(calls).toContainEqual(["npm", "install", "--global", "@kriscard/kstack@latest"]);
  expect(calls.filter((call) => call.includes("--agent") && call.includes("pi"))).toHaveLength(4);
  expect(
    calls.some((call) => {
      const agent = call.indexOf("--agent");

      return agent !== -1 && call[agent + 1] === "*";
    }),
  ).toBe(false);
});
