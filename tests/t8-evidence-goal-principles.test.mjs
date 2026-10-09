import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{
 *   pullRequest: string,
 *   headSha: string,
 *   baseSha: string,
 *   evidenceIds: string[]
 * }} EvidenceVerdict
 */

/**
 * @typedef {{
 *   pullRequest: string,
 *   headSha: string,
 *   baseSha: string,
 *   expectedEvidenceIds: string[],
 *   treeSha?: string
 * }} CurrentRevision
 */

/**
 * @typedef {{
 *   stage: "planning" | "implementation",
 *   goalCount: number,
 *   separationUnsafe: boolean,
 *   meaningfulReviewBoundary: boolean,
 *   approvedCombined: boolean,
 *   approvedReason: string,
 *   proposedCombined: boolean
 * }} GroupingFacts
 */

const skillContracts = [
  {
    name: "principle-evidence-follows-the-commit",
    evaluationCases: ["EF-Positive", "EF-Negative", "EF-Boundary"],
    requiredRuleFragments: [
      "exact head SHA",
      "exact base SHA",
      "expected evidence IDs",
      "mark the verdict stale",
    ],
  },
  {
    name: "principle-one-goal-per-pull-request",
    evaluationCases: ["OG-Positive", "OG-Negative", "OG-Boundary"],
    requiredRuleFragments: [
      "independently reviewable goal",
      "approved plan records why separation would be unsafe",
      "never change approved grouping silently",
    ],
  },
];

/** @param {string} contents */
function frontmatterName(contents) {
  return contents.match(/^---\n[\s\S]*?^name:\s*([^\n]+)$/m)?.[1].trim();
}

/** @param {string} contents */
function decisionRule(contents) {
  return contents.match(/^## Decision rule\n\n\*\*([^\n]+)\*\*$/m)?.[1];
}

/** @param {string} contents */
function evaluationCaseIds(contents) {
  return [
    ...contents.matchAll(/^\| ((?:EF|OG)-(?:Positive|Negative|Boundary)) \|/gm),
  ].map(([, id]) => id);
}

/**
 * @param {string[]} left
 * @param {string[]} right
 */
function sameMembers(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

/**
 * @param {{ verdict: EvidenceVerdict, current: CurrentRevision }} binding
 */
function assessEvidenceFreshness({ verdict, current }) {
  const exactRevisionMatches =
    verdict.pullRequest === current.pullRequest &&
    verdict.headSha === current.headSha &&
    verdict.baseSha === current.baseSha;
  const evidenceSetMatches = sameMembers(
    verdict.evidenceIds,
    current.expectedEvidenceIds,
  );

  return exactRevisionMatches && evidenceSetMatches ? "current" : "stale";
}

/** @param {GroupingFacts} facts */
function choosePullRequestGrouping({
  stage,
  goalCount,
  separationUnsafe,
  meaningfulReviewBoundary,
  approvedCombined,
  approvedReason,
  proposedCombined,
}) {
  if (stage === "implementation" && proposedCombined !== approvedCombined) {
    return "return-to-planning";
  }

  if (goalCount === 1) return "keep-one-goal-pr";

  const combinationIsNecessary = separationUnsafe || !meaningfulReviewBoundary;
  if (combinationIsNecessary) {
    return approvedReason ? "keep-approved-combination" : "record-reason";
  }

  if (stage === "implementation" && approvedCombined) {
    return "return-to-planning";
  }

  return "split-independent-goals";
}

describe("T8 evidence and goal principle skill contracts", () => {
  test.each(skillContracts)(
    "$name is independently installable and carries its evaluation cases",
    async ({ name, evaluationCases, requiredRuleFragments }) => {
      const contents = await readFile(
        resolve(root, "skills", "dev", name, "SKILL.md"),
        "utf8",
      );

      assert.equal(frontmatterName(contents), name);
      for (const heading of [
        "Activate when",
        "Decision rule",
        "Limits and counterexamples",
        "Observable change",
        "Evaluation cases",
      ]) {
        assert.match(contents, new RegExp(`^## ${heading}$`, "m"));
      }

      const rule = decisionRule(contents);
      assert.ok(rule, `${name} must expose one bold decision rule`);
      for (const fragment of requiredRuleFragments) {
        assert.match(rule, new RegExp(fragment, "i"));
      }
      assert.deepEqual(evaluationCaseIds(contents), evaluationCases);
    },
  );
});

describe("principle-evidence-follows-the-commit evaluations", () => {
  const verified = {
    pullRequest: "kriscard/Kriscard-Stack#8",
    headSha: "aaa111",
    baseSha: "bbb222",
    evidenceIds: ["V8-catalog", "V8-cases"],
  };

  test.each([
    {
      kind: "positive",
      current: {
        pullRequest: "kriscard/Kriscard-Stack#8",
        headSha: "ccc333",
        baseSha: "bbb222",
        expectedEvidenceIds: ["V8-catalog", "V8-cases"],
      },
      expected: "stale",
    },
    {
      kind: "negative",
      current: {
        pullRequest: "kriscard/Kriscard-Stack#8",
        headSha: "aaa111",
        baseSha: "bbb222",
        expectedEvidenceIds: ["V8-cases", "V8-catalog"],
      },
      expected: "current",
    },
    {
      kind: "boundary: identical tree under a recreated commit",
      current: {
        pullRequest: "kriscard/Kriscard-Stack#8",
        headSha: "ddd444",
        baseSha: "bbb222",
        expectedEvidenceIds: ["V8-catalog", "V8-cases"],
        treeSha: "same-tree-as-aaa111",
      },
      expected: "stale",
    },
  ])("$kind case returns $expected", ({ current, expected }) => {
    assert.equal(
      assessEvidenceFreshness({ verdict: verified, current }),
      expected,
    );
  });

  test("a changed lower stack layer makes the exact-base verdict stale", () => {
    assert.equal(
      assessEvidenceFreshness({
        verdict: verified,
        current: {
          pullRequest: verified.pullRequest,
          headSha: verified.headSha,
          baseSha: "new-lower-layer",
          expectedEvidenceIds: verified.evidenceIds,
        },
      }),
      "stale",
    );
  });
});

describe("principle-one-goal-per-pull-request evaluations", () => {
  test.each([
    {
      kind: "positive",
      facts: {
        stage: "planning",
        goalCount: 2,
        separationUnsafe: false,
        meaningfulReviewBoundary: true,
        approvedCombined: false,
        approvedReason: "",
        proposedCombined: true,
      },
      expected: "split-independent-goals",
    },
    {
      kind: "negative",
      facts: {
        stage: "planning",
        goalCount: 1,
        separationUnsafe: false,
        meaningfulReviewBoundary: false,
        approvedCombined: true,
        approvedReason: "",
        proposedCombined: true,
      },
      expected: "keep-one-goal-pr",
    },
    {
      kind: "boundary: separation leaves an invalid intermediate",
      facts: {
        stage: "planning",
        goalCount: 2,
        separationUnsafe: true,
        meaningfulReviewBoundary: false,
        approvedCombined: true,
        approvedReason:
          "Source and generated schema cannot land separately without invalid output.",
        proposedCombined: true,
      },
      expected: "keep-approved-combination",
    },
  ])("$kind case returns $expected", ({ facts, expected }) => {
    assert.equal(
      choosePullRequestGrouping(/** @type {GroupingFacts} */ (facts)),
      expected,
    );
  });

  test("implementation returns to planning instead of silently regrouping", () => {
    assert.equal(
      choosePullRequestGrouping({
        stage: "implementation",
        goalCount: 2,
        separationUnsafe: false,
        meaningfulReviewBoundary: true,
        approvedCombined: false,
        approvedReason: "",
        proposedCombined: true,
      }),
      "return-to-planning",
    );
  });
});
