import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { afterEach, expect, test } from "vitest";

import {
  defaultStateFile,
  initializeKriscard,
  parseModel,
  runKriscard,
} from "../src/run.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("parses a provider-qualified model", () => {
  expect(parseModel("anthropic:claude-sonnet-4-6")).toEqual({
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  });
  expect(() => parseModel("claude-sonnet-4-6")).toThrow(
    "Model must use <provider>:<model-id>",
  );
});

test("uses one stable state file per working directory", () => {
  expect(defaultStateFile("/tmp/project")).toBe(
    defaultStateFile("/tmp/project"),
  );
  expect(defaultStateFile("/tmp/project")).not.toBe(
    defaultStateFile("/tmp/another-project"),
  );
});

test("initializes a durable conversation before its first prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kriscard-runner-"));
  temporaryDirectories.push(directory);
  const stateFile = join(directory, "agent.sqlite");

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  await expect(
    initializeKriscard({
      cwd: directory,
      model: "faux:faux-1",
      stateFile,
      models,
    }),
  ).resolves.toBeUndefined();
  await expect(readFile(stateFile)).resolves.not.toHaveLength(0);
});

test("runs a coding agent through persistent Pi Durable storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kriscard-runner-"));
  temporaryDirectories.push(directory);
  const stateFile = join(directory, "agent.sqlite");

  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage("Done.")]);
  const models = createModels();
  models.setProvider(faux.provider);

  await expect(
    runKriscard({
      prompt: "Handle this request.",
      cwd: directory,
      model: "faux:faux-1",
      stateFile,
      models,
    }),
  ).resolves.toBe("Done.");
  await expect(readFile(stateFile)).resolves.not.toHaveLength(0);
});
