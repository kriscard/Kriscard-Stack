#!/usr/bin/env node

import { runKriscard } from "./run.js";

const prompt = process.argv
  .slice(2)
  .filter((argument) => argument !== "--")
  .join(" ")
  .trim();
if (!prompt || prompt === "--help") {
  console.log(`Usage: KRISCARD_MODEL=<provider>:<model-id> kriscard "<request>"

Runs one durable Kriscard agent for the current working directory. Running the
command again resumes the same Pi Durable conversation.`);
  process.exit(prompt === "--help" ? 0 : 1);
}

const model = process.env.KRISCARD_MODEL;
if (!model) {
  console.error(
    "Set KRISCARD_MODEL to <provider>:<model-id>, for example anthropic:claude-sonnet-4-6",
  );
  process.exit(1);
}

try {
  console.log(await runKriscard({ prompt, cwd: process.cwd(), model }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
