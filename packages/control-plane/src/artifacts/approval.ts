import { artifactStoreError } from "./errors.js";

export interface ApprovedHashes {
  spec: string;
  plan: string;
}

const shaPattern = "([0-9a-f]{64})";

/** Extracts the approved specification and plan hashes from approval Markdown. */
export function parseApprovedHashes(markdown: string): ApprovedHashes {
  return {
    spec: extractHash(markdown, "spec.md"),
    plan: extractHash(markdown, "plan.md"),
  };
}

function extractHash(markdown: string, fileName: string): string {
  const escapedName = fileName.replaceAll(".", "\\.");
  const pattern = new RegExp(
    "- `" + escapedName + "`\\s*\\n\\s*- SHA-256: `" + shaPattern + "`",
    "g",
  );
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw artifactStoreError(
      "INVALID_ARTIFACT",
      `Approval must contain exactly one SHA-256 entry for ${fileName}`,
    );
  }
  return matches[0][1];
}
