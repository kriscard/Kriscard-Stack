#!/usr/bin/env node
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { doctor } from "./doctor.js";
import { setup } from "./setup.js";

const usage = `kriscard-stack <doctor|setup> --stack <checkout> --skills <compatible-checkout>

  --home <directory>          Destination home (default: current user's home)
  --stow-source <directory>   Explicit Stow package root, never guessed
  --mode <plain-skills|runtime>  Setup mode (required for setup)
  --host <pi|claude>          Initiating host (required for setup)
  --retention-days <days>     Raw log retention (required for setup)
  --dry-run                  Preview setup without writing
  --json                     Print read-only doctor results as JSON
  --help                     Show this help

Setup checks both source checkouts; it does not clone a different revision or install optional tools.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      stack: { type: "string" },
      skills: { type: "string" },
      home: { type: "string" },
      "stow-source": { type: "string" },
      mode: { type: "string" },
      host: { type: "string" },
      "retention-days": { type: "string" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || (command !== "setup" && command !== "doctor"))
    throw new Error("Choose setup or doctor; use --help for syntax.");
  if (!values.stack || !values.skills)
    throw new Error(
      "Supply --stack and --skills checkout paths; setup will not guess or clone them.",
    );
  const sources = {
    stackRepository: values.stack,
    generalRepository: values.skills,
  };
  if (command === "doctor") {
    const result = await doctor(sources);
    process.stdout.write(
      values.json
        ? JSON.stringify(result, null, 2) + "\n"
        : result.diagnostics
            .map(
              (entry) =>
                `${entry.status.toUpperCase()} ${entry.id}: ${entry.message}${entry.fix ? `\n  Fix: ${entry.fix}` : ""}`,
            )
            .join("\n") + "\n",
    );
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (values.json) throw new Error("--json is supported by doctor only.");
  if (values.mode !== "plain-skills" && values.mode !== "runtime")
    throw new Error("Choose --mode plain-skills or --mode runtime.");
  if (values.host !== "pi" && values.host !== "claude")
    throw new Error("Choose --host pi or --host claude.");
  if (
    !values["retention-days"] ||
    !/^[1-9][0-9]*$/.test(values["retention-days"])
  )
    throw new Error("Supply --retention-days as a positive whole number.");
  const result = await setup(
    {
      ...sources,
      home: values.home ?? homedir(),
      mode: values.mode,
      host: values.host,
      rawLogRetentionDays: Number(values["retention-days"]),
      ...(values["stow-source"] ? { stowSource: values["stow-source"] } : {}),
    },
    async (proposal) => {
      process.stdout.write(
        `Proposed destination: ${proposal.destination}\nChanged settings: ${proposal.changes.join(", ")}\n`,
      );
      if (values["dry-run"] || !process.stdin.isTTY || !process.stdout.isTTY)
        return false;
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return (
          (await prompt.question("Apply these changes? [y/N] "))
            .trim()
            .toLowerCase() === "y"
        );
      } finally {
        prompt.close();
      }
    },
  );
  if (!result.proposal.diagnostics.ok) {
    for (const entry of result.proposal.diagnostics.diagnostics.filter(
      (entry) => entry.status === "fail",
    ))
      process.stdout.write(
        `FAIL ${entry.id}: ${entry.message}\n  Fix: ${entry.fix ?? "Rerun doctor."}\n`,
      );
    process.exitCode = 1;
  } else
    process.stdout.write(
      result.applied ? "Setup settings saved.\n" : "No settings changed.\n",
    );
}

void main().catch(() => {
  // Arguments and underlying tool output may contain sensitive user data.
  process.stderr.write(
    "Setup or doctor could not complete. Check the paths and options with --help; existing settings are preserved.\n",
  );
  process.exitCode = 1;
});
