import { expect, test, vi } from "vitest";

import {
  applySetupPlan,
  createSetupPlan,
  formatSetupPlan,
  type CommandRunner,
} from "../src/installer.js";

function fakeRunner(installedSource = "kriscard/Skills") {
  const runner: CommandRunner = vi.fn(async (command, args, _options) => {
    if (command === "herdr") {
      return { code: 0, stdout: "Herdr", stderr: "" };
    }

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
          {
            name: "debug",
            source: installedSource,
            agents: ["Pi"],
          },
          {
            name: "herdr",
            source: "ogulcancelik/herdr",
            agents: ["Pi"],
          },
        ]),
        stderr: "",
      };
    }

    return { code: 0, stdout: "", stderr: "" };
  });

  return runner;
}

test("discovers trusted candidates without conflicting same-source updates", async () => {
  const plan = await createSetupPlan(fakeRunner());

  expect(plan.candidates).toEqual(
    expect.arrayContaining([
      { name: "debug", source: "kriscard/Skills" },
      { name: "kriscard-mode", source: "kriscard/Kriscard-Stack" },
      { name: "herdr", source: "herdrdev/herdr" },
    ]),
  );
  expect(plan.conflicts).toEqual([]);
  expect(plan.herdrAvailable).toBe(true);
  expect(formatSetupPlan(plan, "Setup")).toContain("DO_NOT_TRACK=1 or DISABLE_TELEMETRY=1");
});

test("rejects malformed installed skill metadata", async () => {
  const fallback = fakeRunner();

  const runner: CommandRunner = async (command, args, options) => {
    if (args.includes("list") && !args.includes("--list")) {
      return {
        code: 0,
        stdout: JSON.stringify([{ name: 42, source: "kriscard/Skills" }]),
        stderr: "",
      };
    }

    return fallback(command, args, options);
  };

  await expect(createSetupPlan(runner)).rejects.toThrow(
    "Installed skill discovery returned an unexpected shape",
  );
});

test("blocks a candidate name owned by another source", async () => {
  const plan = await createSetupPlan(fakeRunner("someone/else"));

  expect(plan.conflicts).toEqual([
    {
      name: "debug",
      candidateSource: "kriscard/Skills",
      installedSource: "someone/else",
    },
  ]);
  await expect(applySetupPlan(plan, fakeRunner())).rejects.toThrow(
    "Resolve the reported skill ownership conflicts",
  );
});
