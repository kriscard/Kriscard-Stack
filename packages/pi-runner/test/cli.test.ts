import { Readable, Writable } from "node:stream";

import { expect, test, vi } from "vitest";

import { main, parseCommand } from "../src/cli.js";
import type { CommandRunner } from "../src/installer.js";
import type { openKriscardConversation, runKriscard } from "../src/run.js";

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

test("parses the documented command surface", () => {
  expect(parseCommand([])).toEqual({
    type: "interactive",
    session: "default",
    existence: "any",
  });
  expect(parseCommand(["--session", "checkout"])).toEqual({
    type: "interactive",
    session: "checkout",
    existence: "any",
  });
  expect(parseCommand(["run", "--session", "checkout", "fix", "it"])).toEqual({
    type: "run",
    session: "checkout",
    prompt: "fix it",
  });
  expect(parseCommand(["legacy", "request"])).toEqual({
    type: "run",
    session: "default",
    prompt: "legacy request",
  });
  expect(parseCommand(["new", "checkout"])).toEqual({
    type: "interactive",
    session: "checkout",
    existence: "must-not-exist",
  });
  expect(parseCommand(["resume", "checkout"])).toEqual({
    type: "interactive",
    session: "checkout",
    existence: "must-exist",
  });
  expect(parseCommand(["remove", "checkout", "--yes"])).toEqual({
    type: "remove",
    session: "checkout",
    yes: true,
  });
});

test("submits one-shot requests to the selected durable session", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const runAgent = vi.fn<typeof runKriscard>(async () => "Done.");

  await expect(
    main(["run", "--session", "checkout", "Fix", "it"], {
      cwd: "/tmp/project",
      model: "faux:faux-1",
      input: Readable.from([]),
      output: output.stream,
      error: error.stream,
      runAgent,
    }),
  ).resolves.toBe(0);

  expect(runAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "Fix it",
      cwd: "/tmp/project",
      model: "faux:faux-1",
      stateFile: expect.stringMatching(/checkout\.sqlite$/),
    }),
  );
  expect(output.read()).toBe("Done.\n");
  expect(error.read()).toBe("");
});

test("keeps multiple interactive turns in one named session", async () => {
  const output = outputBuffer();
  const error = outputBuffer();
  const submit = vi.fn(async (prompt: string) => `Answer: ${prompt}`);
  const close = vi.fn(async () => undefined);

  const openConversation = vi.fn<typeof openKriscardConversation>(async () => ({
    submit,
    close,
  }));

  await expect(
    main(["--session", "checkout"], {
      cwd: "/tmp/project",
      model: "faux:faux-1",
      input: Readable.from(["first\nsecond\nexit\n"]),
      output: output.stream,
      error: error.stream,
      openConversation,
    }),
  ).resolves.toBe(0);

  expect(openConversation).toHaveBeenCalledOnce();
  expect(openConversation).toHaveBeenCalledWith(
    expect.objectContaining({
      stateFile: expect.stringMatching(/checkout\.sqlite$/),
      existence: "any",
    }),
  );
  expect(submit).toHaveBeenNthCalledWith(1, "first");
  expect(submit).toHaveBeenNthCalledWith(2, "second");
  expect(close).toHaveBeenCalledOnce();
  expect(output.read()).toContain("Answer: first\nAnswer: second\n");
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

  expect(output.read()).toContain("Global Pi skills (4");
  expect(output.read()).toContain("Unrelated installed skills will not be removed");
  expect(output.read()).toContain("Setup complete");
  expect(error.read()).toBe("");
  expect(calls).toContainEqual(["npm", "install", "--global", "@kriscard/kstack@latest"]);
  expect(calls.filter((call) => call.includes("--agent") && call.includes("pi"))).toHaveLength(5);
  expect(
    calls.some((call) => {
      const agent = call.indexOf("--agent");

      return agent !== -1 && call[agent + 1] === "*";
    }),
  ).toBe(false);
});
