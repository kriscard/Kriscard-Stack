import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const skillPaths = {
  "principle-stop-on-plan-drift": resolve(
    root,
    "skills/dev/principle-stop-on-plan-drift/SKILL.md",
  ),
  "principle-minimize-context": resolve(
    root,
    "skills/dev/principle-minimize-context/SKILL.md",
  ),
};

/**
 * @typedef {{ approvedTask: boolean, departure?: string, contradiction?: string }} PlanDriftInput
 */

/** @param {PlanDriftInput} input */
function decidePlanDrift({ approvedTask, departure, contradiction }) {
  if (!approvedTask) {
    return {
      activates: false,
      action: "use-enclosing-workflow",
      preserveState: true,
      planningDecision: false,
    };
  }

  const detectedDeparture =
    departure !== undefined || contradiction !== undefined;
  if (!detectedDeparture) {
    return {
      activates: false,
      action: "continue-approved-task",
      preserveState: true,
      planningDecision: false,
    };
  }

  return {
    activates: true,
    action: "stop-before-unapproved-change",
    preserveState: true,
    planningDecision: true,
    reason: departure ?? contradiction,
  };
}

/**
 * @typedef {{
 *   id: string,
 *   relevant?: boolean,
 *   required?: boolean,
 *   kind: "artifact" | "raw-output",
 *   bytes: number,
 *   receipt?: string
 * }} ContextItem
 */

/** @param {{ items: ContextItem[], rawOutputLimit: number }} input */
function buildContextPacket({ items, rawOutputLimit }) {
  const included = [];
  const excluded = [];
  let filtered = false;

  for (const item of items) {
    if (!item.relevant && !item.required) {
      excluded.push(item.id);
      continue;
    }

    if (item.kind === "raw-output" && item.bytes > rawOutputLimit) {
      if (!item.receipt) throw new Error(`${item.id} needs a durable receipt`);
      included.push({
        id: item.id,
        form: "bounded-excerpt",
        receipt: item.receipt,
      });
      filtered = true;
      continue;
    }

    included.push({ id: item.id, form: "intact" });
  }

  return {
    activates: filtered || excluded.length > 0,
    included,
    excluded,
  };
}

describe("T8 drift and context principle contracts", () => {
  for (const [name, path] of Object.entries(skillPaths)) {
    it(`${name} is a self-contained principle skill`, async () => {
      const contents = await readFile(path, "utf8");

      expect(contents).toMatch(new RegExp(`^---\\nname: ${name}\\n`, "u"));
      expect(contents).toContain("## Activation evidence");
      expect(contents).toContain("## Decision rule");
      expect(contents).toContain("## Limits and counterexamples");
      expect(contents).toContain("## Observable decision");
      expect(contents).toContain("## Evaluation cases");
      expect(contents).toContain("### Positive");
      expect(contents).toContain("### Negative");
      expect(contents).toContain("### Boundary");
    });
  }
});

describe("principle-stop-on-plan-drift evaluations", () => {
  it("positive: stops before an undeclared path change", () => {
    expect(
      decidePlanDrift({
        approvedTask: true,
        departure: "packages/cli is outside the approved packages/core path",
      }),
    ).toEqual({
      activates: true,
      action: "stop-before-unapproved-change",
      preserveState: true,
      planningDecision: true,
      reason: "packages/cli is outside the approved packages/core path",
    });
  });

  it("negative: continues an expressly delegated implementation detail", () => {
    expect(
      decidePlanDrift({
        approvedTask: true,
      }),
    ).toEqual({
      activates: false,
      action: "continue-approved-task",
      preserveState: true,
      planningDecision: false,
    });
  });

  it("boundary: contradictory repository facts stop before a replacement design", () => {
    expect(
      decidePlanDrift({
        approvedTask: true,
        contradiction: "the pinned dependency does not provide the planned API",
      }),
    ).toEqual({
      activates: true,
      action: "stop-before-unapproved-change",
      preserveState: true,
      planningDecision: true,
      reason: "the pinned dependency does not provide the planned API",
    });
  });
});

describe("principle-minimize-context evaluations", () => {
  it("positive: excludes unrelated history and filters large mechanical output", () => {
    expect(
      buildContextPacket({
        rawOutputLimit: 1_000,
        items: [
          {
            id: "assigned-requirement",
            relevant: true,
            kind: "artifact",
            bytes: 300,
          },
          {
            id: "governing-instructions",
            required: true,
            kind: "artifact",
            bytes: 250,
          },
          {
            id: "other-task-history",
            relevant: false,
            kind: "artifact",
            bytes: 5_000,
          },
          {
            id: "build-output",
            relevant: true,
            kind: "raw-output",
            bytes: 20_000,
            receipt: "receipt://build-42",
          },
        ],
      }),
    ).toEqual({
      activates: true,
      included: [
        { id: "assigned-requirement", form: "intact" },
        { id: "governing-instructions", form: "intact" },
        {
          id: "build-output",
          form: "bounded-excerpt",
          receipt: "receipt://build-42",
        },
      ],
      excluded: ["other-task-history"],
    });
  });

  it("negative: keeps a small directly relevant interface intact", () => {
    expect(
      buildContextPacket({
        rawOutputLimit: 1_000,
        items: [
          {
            id: "relevant-interface",
            relevant: true,
            kind: "artifact",
            bytes: 600,
          },
        ],
      }),
    ).toEqual({
      activates: false,
      included: [{ id: "relevant-interface", form: "intact" }],
      excluded: [],
    });
  });

  it("boundary: preserves a causal failure excerpt and its full receipt", () => {
    expect(
      buildContextPacket({
        rawOutputLimit: 1_000,
        items: [
          {
            id: "required-failure-log",
            required: true,
            kind: "raw-output",
            bytes: 50_000,
            receipt: "receipt://test-failure-7",
          },
        ],
      }),
    ).toEqual({
      activates: true,
      included: [
        {
          id: "required-failure-log",
          form: "bounded-excerpt",
          receipt: "receipt://test-failure-7",
        },
      ],
      excluded: [],
    });
  });
});
