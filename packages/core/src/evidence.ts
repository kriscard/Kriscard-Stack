import type { WorkerId } from "./ids.js";
import type { EvidenceCategory, EvidenceVerdict } from "./schemas.js";

export type EvidenceReadinessReason =
  | "VERDICT_NOT_VERIFIED"
  | "STALE_HEAD"
  | "STALE_BASE"
  | "IMPLEMENTER_SELF_VERIFICATION"
  | "DUPLICATE_CATEGORY"
  | "MISSING_CATEGORY"
  | "CATEGORY_NOT_PASSED";

export interface EvidenceReadiness {
  ready: boolean;
  reasons: EvidenceReadinessReason[];
}

const requiredCategories: EvidenceCategory[] = [
  "repository_checks",
  "product_behavior",
  "requirement_coverage",
  "risk_review",
];

export function evaluateEvidenceReadiness(input: {
  verdict: EvidenceVerdict;
  currentHeadSha: string;
  currentBaseSha?: string;
  implementerWorkerId: WorkerId;
}): EvidenceReadiness {
  const reasons = new Set<EvidenceReadinessReason>();
  const { verdict } = input;

  if (verdict.verdict !== "verified") reasons.add("VERDICT_NOT_VERIFIED");
  if (verdict.headSha !== input.currentHeadSha) reasons.add("STALE_HEAD");
  if (
    input.currentBaseSha !== undefined &&
    verdict.baseSha !== input.currentBaseSha
  ) {
    reasons.add("STALE_BASE");
  }
  if (verdict.verifierWorkerId === input.implementerWorkerId) {
    reasons.add("IMPLEMENTER_SELF_VERIFICATION");
  }

  const categories = new Map(
    verdict.categoryResults.map((result) => [result.category, result.status]),
  );
  if (categories.size !== verdict.categoryResults.length) {
    reasons.add("DUPLICATE_CATEGORY");
  }
  for (const category of requiredCategories) {
    const status = categories.get(category);
    if (!status) reasons.add("MISSING_CATEGORY");
    else if (status !== "passed") reasons.add("CATEGORY_NOT_PASSED");
  }

  return { ready: reasons.size === 0, reasons: [...reasons] };
}
