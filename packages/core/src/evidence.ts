import type { UnitId, WorkerId } from "./ids.js";
import type {
  EvidenceCategory,
  EvidenceVerdict,
  ExecutionUnit,
  WorkItem,
} from "./schemas.js";

export type EvidenceReadinessReason =
  | "VERDICT_NOT_VERIFIED"
  | "INVALID_SHA"
  | "STALE_HEAD"
  | "STALE_BASE"
  | "IMPLEMENTER_SELF_VERIFICATION"
  | "VERDICT_UNIT_MISMATCH"
  | "DUPLICATE_EVIDENCE"
  | "MISSING_EVIDENCE"
  | "UNEXPECTED_EVIDENCE"
  | "DUPLICATE_CATEGORY"
  | "MISSING_CATEGORY"
  | "CATEGORY_NOT_PASSED";

export interface EvidenceReadiness {
  ready: boolean;
  reasons: EvidenceReadinessReason[];
}

export interface EvidenceContext {
  verdict: EvidenceVerdict;
  currentHeadSha: string;
  currentBaseSha: string;
  implementerWorkerId: WorkerId;
}

export type WorkItemReadinessReason =
  | EvidenceReadinessReason
  | "MISSING_ACTIVE_REVISION"
  | "NO_EXPECTED_UNITS"
  | "DUPLICATE_EXPECTED_UNIT"
  | "MISSING_EXPECTED_UNIT"
  | "UNEXPECTED_EXPECTED_UNIT"
  | "UNIT_WORK_ITEM_MISMATCH"
  | "UNIT_REVISION_MISMATCH"
  | "MISSING_UNIT_VERDICT"
  | "DUPLICATE_UNIT_VERDICT"
  | "UNEXPECTED_UNIT_VERDICT";

export interface WorkItemReadiness {
  ready: boolean;
  reasons: WorkItemReadinessReason[];
}

export interface WorkItemEvidence {
  units: readonly ExecutionUnit[];
  evidence: readonly EvidenceContext[];
}

const gitShaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const requiredCategories: EvidenceCategory[] = [
  "repository_checks",
  "product_behavior",
  "requirement_coverage",
  "risk_review",
];

/** Checks whether one verdict is current and belongs to the expected unit. */
export function evaluateEvidenceReadiness(
  unit: ExecutionUnit,
  input: EvidenceContext,
): EvidenceReadiness {
  const reasons = new Set<EvidenceReadinessReason>();
  const { verdict } = input;

  if (verdict.verdict !== "verified") reasons.add("VERDICT_NOT_VERIFIED");
  if (
    !gitShaPattern.test(verdict.headSha) ||
    !gitShaPattern.test(verdict.baseSha) ||
    !gitShaPattern.test(input.currentHeadSha) ||
    !gitShaPattern.test(input.currentBaseSha)
  ) {
    reasons.add("INVALID_SHA");
  }
  if (verdict.headSha !== input.currentHeadSha) reasons.add("STALE_HEAD");
  if (verdict.baseSha !== input.currentBaseSha) reasons.add("STALE_BASE");
  if (verdict.verifierWorkerId === input.implementerWorkerId) {
    reasons.add("IMPLEMENTER_SELF_VERIFICATION");
  }
  if (verdict.unitId !== unit.id) reasons.add("VERDICT_UNIT_MISMATCH");

  const actualEvidence = new Set(verdict.evidenceIds);
  if (actualEvidence.size !== verdict.evidenceIds.length) {
    reasons.add("DUPLICATE_EVIDENCE");
  }
  const expectedEvidence = new Set(unit.expectedEvidenceIds);
  for (const evidenceId of expectedEvidence) {
    if (!actualEvidence.has(evidenceId)) reasons.add("MISSING_EVIDENCE");
  }
  for (const evidenceId of actualEvidence) {
    if (!expectedEvidence.has(evidenceId)) reasons.add("UNEXPECTED_EVIDENCE");
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

/** Checks that every expected unit in a work item has one current verdict. */
export function evaluateWorkItemReadiness(
  workItem: WorkItem,
  input: WorkItemEvidence,
): WorkItemReadiness {
  const reasons = new Set<WorkItemReadinessReason>();
  if (!workItem.activeRevisionId) reasons.add("MISSING_ACTIVE_REVISION");

  const expectedUnitIds = workItem.executionUnitIds ?? [];
  if (expectedUnitIds.length === 0) reasons.add("NO_EXPECTED_UNITS");
  const expectedUnitIdSet = new Set(expectedUnitIds);
  if (expectedUnitIdSet.size !== expectedUnitIds.length) {
    reasons.add("DUPLICATE_EXPECTED_UNIT");
  }

  const unitsById = new Map<UnitId, ExecutionUnit>();
  for (const unit of input.units) {
    if (unitsById.has(unit.id)) reasons.add("DUPLICATE_EXPECTED_UNIT");
    else unitsById.set(unit.id, unit);
    if (!expectedUnitIdSet.has(unit.id))
      reasons.add("UNEXPECTED_EXPECTED_UNIT");
    if (unit.workItemId !== workItem.id) reasons.add("UNIT_WORK_ITEM_MISMATCH");
    if (
      workItem.activeRevisionId &&
      unit.revisionId !== workItem.activeRevisionId
    ) {
      reasons.add("UNIT_REVISION_MISMATCH");
    }
  }
  for (const expectedUnitId of expectedUnitIdSet) {
    if (!unitsById.has(expectedUnitId)) reasons.add("MISSING_EXPECTED_UNIT");
  }

  const evidenceByUnit = new Map<UnitId, EvidenceContext>();
  for (const evidence of input.evidence) {
    const unitId = evidence.verdict.unitId;
    if (!unitsById.has(unitId)) reasons.add("UNEXPECTED_UNIT_VERDICT");
    if (evidenceByUnit.has(unitId)) reasons.add("DUPLICATE_UNIT_VERDICT");
    else evidenceByUnit.set(unitId, evidence);
  }

  for (const unit of unitsById.values()) {
    const evidence = evidenceByUnit.get(unit.id);
    if (!evidence) {
      reasons.add("MISSING_UNIT_VERDICT");
      continue;
    }
    for (const reason of evaluateEvidenceReadiness(unit, evidence).reasons) {
      reasons.add(reason);
    }
  }

  return { ready: reasons.size === 0, reasons: [...reasons] };
}
