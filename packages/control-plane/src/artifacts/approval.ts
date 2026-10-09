import * as z from "zod";

import { artifactStoreError } from "./errors.js";

export interface ApprovedHashes {
  spec: string;
  plan: string;
}

const shaPattern = "([0-9a-f]{64})";
const approvalMethods = new Set([
  "Plannotator",
  "Explicit chat approval",
  "Mixed",
]);

/** Validates the complete approval lifecycle and returns its canonical hashes. */
export function parseApprovedHashes(markdown: string): ApprovedHashes {
  const approvalHeadings = markdown.match(/^# Approval\s*$/gm) ?? [];
  if (approvalHeadings.length !== 1 || !markdown.startsWith("# Approval\n")) {
    invalid("Approval must begin with exactly one # Approval heading");
  }

  const status = extractMetadata(markdown, "Status");
  if (status !== "Approved") {
    invalid("Approval status must be Approved");
  }

  const method = extractMetadata(markdown, "Method");
  if (!approvalMethods.has(method)) {
    invalid(
      "Approval method must be Plannotator, Explicit chat approval, or Mixed",
    );
  }

  const approvedAt = extractMetadata(markdown, "Approved at");
  if (!z.iso.datetime({ offset: true }).safeParse(approvedAt).success) {
    invalid("Approval timestamp must be an ISO-8601 datetime");
  }

  const artifacts = extractSection(markdown, "Approved artifacts");
  const stages = extractSection(markdown, "Stage approvals");
  const exceptions = extractSection(markdown, "Exceptions");
  if (!exceptions.trim()) {
    invalid("Approval Exceptions section must not be empty");
  }

  for (const stage of ["Requirements", "Technical Design", "Plan"]) {
    extractStageDecision(stages, stage);
  }

  return {
    spec: extractHash(artifacts, "spec.md"),
    plan: extractHash(artifacts, "plan.md"),
  };
}

function extractMetadata(markdown: string, name: string): string {
  const escapedName = name.replaceAll(" ", "\\s+");
  const matches = [
    ...markdown.matchAll(
      new RegExp(`^${escapedName}:[ \\t]*(.*?)[ \\t]*$`, "gm"),
    ),
  ];
  const value = matches[0]?.[1];
  if (matches.length !== 1 || !value) {
    invalid(`Approval must contain exactly one non-empty ${name} field`);
  }
  return value;
}

function extractSection(markdown: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...markdown.matchAll(new RegExp(`^## ${escapedName}[ \\t]*$`, "gm")),
  ];
  const heading = matches[0];
  if (matches.length !== 1 || heading?.index === undefined) {
    invalid(`Approval must contain exactly one non-empty ${name} section`);
  }
  const bodyStart = heading.index + heading[0].length;
  const nextSection = markdown.indexOf("\n## ", bodyStart);
  const body = markdown.slice(
    bodyStart,
    nextSection === -1 ? markdown.length : nextSection,
  );
  if (!body.trim()) {
    invalid(`Approval must contain exactly one non-empty ${name} section`);
  }
  return body;
}

function extractStageDecision(markdown: string, stage: string): string {
  const escapedStage = stage.replaceAll(" ", "\\s+");
  const matches = [
    ...markdown.matchAll(
      new RegExp(`^- ${escapedStage}:[ \\t]*(.*?)[ \\t]*$`, "gm"),
    ),
  ];
  const decision = matches[0]?.[1];
  if (matches.length !== 1 || !decision) {
    invalid(
      `Approval must contain exactly one non-empty ${stage} stage decision`,
    );
  }
  if (
    !/\bapproved\b/i.test(decision) ||
    /\b(?:rejected|annotated|dismissed|pending|blocked|denied|denial|refused|withheld)\b/i.test(
      decision,
    ) ||
    /\bnot\b.{0,40}\b(?:approved|approval)\b/i.test(decision) ||
    /\bno\b.*\bapproval\b/i.test(decision) ||
    /\bapproval\b.*\bnot\s+granted\b/i.test(decision)
  ) {
    invalid(`${stage} stage decision must record approval without conflict`);
  }
  return decision;
}

function extractHash(markdown: string, fileName: string): string {
  const escapedName = fileName.replaceAll(".", "\\.");
  const pattern = new RegExp(
    "- `" + escapedName + "`\\s*\\n\\s*- SHA-256: `" + shaPattern + "`",
    "g",
  );
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    invalid(`Approval must contain exactly one SHA-256 entry for ${fileName}`);
  }
  return matches[0][1];
}

function invalid(message: string): never {
  throw artifactStoreError("INVALID_ARTIFACT", message);
}
