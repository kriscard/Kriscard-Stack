import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{ activation: string, evidence: string, decision: string }} EvaluationCase
 * @typedef {{ name: string, descriptionEvidence: string[], cases: Record<string, EvaluationCase> }} ExpectedPrinciple
 */

/** @type {ExpectedPrinciple[]} */
const expectedPrinciples = [
  {
    name: "principle-boundary-discipline",
    descriptionEvidence: ["current-task evidence", "Do not load"],
    cases: {
      Positive: {
        activation: "yes",
        evidence:
          "The task asks Stack to reuse a general Skills workflow, and repository guidance says general skills remain owned by `kriscard/Skills`.",
        decision:
          "Reference the general skill by name; do not copy it into Stack.",
      },
      Negative: {
        activation: "no",
        evidence:
          "One approved Stack-owned skill needs coordinated edits to its `SKILL.md` and a local evaluation file, both inside the assigned task boundary.",
        decision:
          "Treat the edits as one bounded change; do not split them merely because two files change.",
      },
      Boundary: {
        activation: "yes",
        evidence:
          "One request contains a Stack-owned principle change and a required change to a general skill in `kriscard/Skills`, but authorization covers only the Stack repository portion.",
        decision:
          "Implement only the authorized Stack increment and hand off or return to planning for the separately owned general-skill change; do not duplicate it.",
      },
    },
  },
  {
    name: "principle-prove-real-behavior",
    descriptionEvidence: ["current-task acceptance criteria", "Do not load"],
    cases: {
      Positive: {
        activation: "yes",
        evidence:
          "Acceptance requires a user to submit a form in the running app, while green unit tests mock the network and a disposable browser fixture is available.",
        decision:
          "Exercise form submission through the disposable running app and require the visible result; keep unit tests as supporting evidence.",
      },
      Negative: {
        activation: "no",
        evidence:
          "Acceptance covers a pure parser's returned value, and focused tests call its public API with representative inputs without any additional runtime wiring.",
        decision:
          "Use the focused public-API tests as the behavior proof; do not invent a browser or manual product flow.",
      },
      Boundary: {
        activation: "yes",
        evidence:
          "Acceptance requires behavior on a mapped device surface, but the required simulator or approved device is unavailable and lower-level tests pass.",
        decision:
          "Record the missing capability and block the proof; do not install the capability or report verification from tests alone.",
      },
    },
  },
];

const requiredSections = [
  "## Activation gate",
  "## Decision rule",
  "## Limits and counterexamples",
  "## Observable changed decision",
  "## Evaluation cases",
];

/** @param {string} value */
function normalized(value) {
  return value.replaceAll(/\s+/g, " ").trim();
}

/** @param {string} contents */
function parseFrontmatter(contents) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("Missing YAML frontmatter");

  const name = match[1].match(/^name:\s*(.+)$/m)?.[1].trim();
  const description = match[1]
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/^description:\s*>-\s*/m, "");

  return { name, description: normalized(description) };
}

/**
 * @param {string} contents
 * @returns {Record<string, EvaluationCase>}
 */
function parseEvaluationCases(contents) {
  const section = contents.split("## Evaluation cases\n")[1];
  if (!section) throw new Error("Missing evaluation cases section");

  const rows = section
    .split("\n")
    .filter((line) => /^\| (Positive|Negative|Boundary) /.test(line));

  return Object.fromEntries(
    rows.map((row) => {
      const [kind, evidence, activation, decision] = row
        .slice(1, -1)
        .split("|")
        .map(normalized);
      return [kind, { evidence, activation, decision }];
    }),
  );
}

describe.each(expectedPrinciples)("$name", (principle) => {
  const path = resolve(root, "skills/dev", principle.name, "SKILL.md");

  it("is an independently installable, selectively activated principle skill", async () => {
    const contents = await readFile(path, "utf8");
    const frontmatter = parseFrontmatter(contents);

    expect(frontmatter.name).toBe(principle.name);
    expect(contents.split("\n").length).toBeLessThanOrEqual(500);
    expect(contents.match(/^\*\*[^\n]+\*\*$/gm)).toHaveLength(1);
    for (const evidence of principle.descriptionEvidence) {
      expect(frontmatter.description).toContain(evidence);
    }
    for (const section of requiredSections) expect(contents).toContain(section);
  });

  it.each(["Positive", "Negative", "Boundary"])(
    "records the %s evaluation's evidence, activation, and changed decision",
    async (kind) => {
      const contents = await readFile(path, "utf8");
      const cases = parseEvaluationCases(contents);

      expect(Object.keys(cases).sort()).toEqual([
        "Boundary",
        "Negative",
        "Positive",
      ]);
      expect(cases[kind]).toEqual(principle.cases[kind]);
      expect(cases[kind].activation).toBe(kind === "Negative" ? "no" : "yes");
    },
  );
});
