import { expect, test } from "vitest";

import {
  buildPiArguments,
  KRISCARD_MODE_DIRECTIVE,
  parseConfiguredModel,
} from "../src/launcher.js";

test("launches native Pi with Kriscard mode enabled", () => {
  expect(
    buildPiArguments({
      arguments: [],
      modePath: "/skills/kriscard-mode",
    }),
  ).toEqual([
    "--skill",
    "/skills/kriscard-mode",
    "--append-system-prompt",
    KRISCARD_MODE_DIRECTIVE,
  ]);
});

test("passes native Pi arguments through unchanged", () => {
  expect(
    buildPiArguments({
      arguments: ["--continue", "Finish the feature"],
      modePath: "/skills/kriscard-mode",
    }),
  ).toEqual([
    "--skill",
    "/skills/kriscard-mode",
    "--append-system-prompt",
    KRISCARD_MODE_DIRECTIVE,
    "--continue",
    "Finish the feature",
  ]);
});

test("adds print mode for one-shot requests", () => {
  expect(
    buildPiArguments({
      arguments: ["Build the feature"],
      modePath: "/skills/kriscard-mode",
      print: true,
    }),
  ).toContain("--print");
});

test("translates the legacy configured model into native Pi flags", () => {
  expect(parseConfiguredModel("openai-codex:gpt-5.6-sol")).toEqual([
    "--provider",
    "openai-codex",
    "--model",
    "gpt-5.6-sol",
  ]);
});

test("rejects malformed configured models", () => {
  expect(() => parseConfiguredModel("gpt-5.6-sol")).toThrow(
    "KRISCARD_MODEL must use <provider>:<model-id>",
  );
});
