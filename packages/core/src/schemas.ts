import * as z from "zod";

import {
  AttemptIdSchema,
  GateIdSchema,
  MachineIdSchema,
  ProjectIdSchema,
  RevisionIdSchema,
  UnitIdSchema,
  VerdictIdSchema,
  WorkerIdSchema,
  WorkItemIdSchema,
} from "./ids.js";

function uniqueStringArray<Element extends z.ZodType<string>>(
  element: Element,
  minimum = 0,
) {
  return z
    .array(element)
    .min(minimum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Array items must be unique",
        });
      }
    })
    .meta({ uniqueItems: true });
}

export const SchemaVersion = z.literal(1);
export const TimestampSchema = z.iso.datetime({ offset: false });
export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
export const TaskIdSchema = z.string().regex(/^T[0-9]+$/);
export const EvidenceIdSchema = z.string().regex(/^V[0-9]+$/);

export const HostSchema = z.enum(["pi", "claude_code"]);
export type Host = z.output<typeof HostSchema>;

export const ActorSchema = z.enum([
  "human",
  "control_plane",
  "implementer",
  "verifier",
  "system",
]);
export type Actor = z.output<typeof ActorSchema>;

export const WorkItemStateSchema = z.enum([
  "discovered",
  "requirements_review",
  "design_review",
  "plan_review",
  "approved",
  "queued",
  "running",
  "verifying",
  "ready_for_human",
  "accepted",
  "rejected",
  "cancelled",
  "blocked",
  "deviation",
  "paused",
]);
export type WorkItemState = z.output<typeof WorkItemStateSchema>;

export const ExecutionUnitStateSchema = z.enum([
  "planned",
  "blocked",
  "ready",
  "leased",
  "running",
  "deviation",
  "failed",
  "implemented",
  "verifying",
  "verification_failed",
  "verified",
  "ready_for_human",
  "accepted",
  "rejected",
]);
export type ExecutionUnitState = z.output<typeof ExecutionUnitStateSchema>;

const StateTransitionCommon = {
  schemaVersion: SchemaVersion,
  actor: ActorSchema,
  reason: z.string().min(1),
  occurredAt: TimestampSchema,
  idempotencyKey: z.string().min(1),
};

export const WorkItemStateTransitionSchema = z.looseObject({
  ...StateTransitionCommon,
  subject: z.literal("work_item"),
  subjectId: WorkItemIdSchema,
  priorState: WorkItemStateSchema,
  nextState: WorkItemStateSchema,
});

export const ExecutionUnitStateTransitionSchema = z.looseObject({
  ...StateTransitionCommon,
  subject: z.literal("execution_unit"),
  subjectId: UnitIdSchema,
  priorState: ExecutionUnitStateSchema,
  nextState: ExecutionUnitStateSchema,
});

export const StateTransitionSchema = z.discriminatedUnion("subject", [
  WorkItemStateTransitionSchema,
  ExecutionUnitStateTransitionSchema,
]);
export type StateTransition = z.output<typeof StateTransitionSchema>;

export const ReplayClassSchema = z.enum([
  "read_only_replayable",
  "idempotent_with_key",
  "reconcile_before_retry",
  "manual_recovery",
]);
export type ReplayClass = z.output<typeof ReplayClassSchema>;

export const CapabilitySchema = z.enum([
  "git",
  "github",
  "pi",
  "claude_code",
  "herdr",
  "tailscale",
  "obsidian",
  "qmd",
  "docker",
  "ios_simulator",
]);
export type Capability = z.output<typeof CapabilitySchema>;

export const ProjectSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: ProjectIdSchema,
  repositoryFingerprint: z.string().min(1),
  canonicalRemote: z.string().min(1),
  localPaths: z.array(z.string().min(1)),
  defaultBranch: z.string().min(1),
  forge: z.literal("github"),
  requiredCapabilities: uniqueStringArray(CapabilitySchema),
});
export type Project = z.output<typeof ProjectSchema>;

export const WorkItemSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: WorkItemIdSchema,
  type: z.enum([
    "feature",
    "bug_fix",
    "refactor",
    "migration",
    "investigation",
    "review",
    "release",
    "orchestration",
  ]),
  source: z.looseObject({
    kind: z.string().min(1),
    reference: z.string().min(1).optional(),
  }),
  projectId: ProjectIdSchema,
  parentWorkItemId: WorkItemIdSchema.optional(),
  childWorkItemIds: uniqueStringArray(WorkItemIdSchema),
  state: WorkItemStateSchema,
  pausedFrom: WorkItemStateSchema.optional(),
  activeRevisionId: RevisionIdSchema.optional(),
  executionUnitIds: uniqueStringArray(UnitIdSchema).optional(),
  initiatingHost: HostSchema,
  policy: z.record(z.string(), z.unknown()),
});
export type WorkItem = z.output<typeof WorkItemSchema>;

export const ApprovalDecisionSchema = z.looseObject({
  stage: z.enum(["requirements", "technical_design", "plan"]),
  decision: z.literal("approved"),
  method: z.string().min(1),
  approvedAt: TimestampSchema,
});

export const ArtifactRevisionSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: RevisionIdSchema,
  workItemId: WorkItemIdSchema,
  paths: z.looseObject({
    spec: z.string().min(1),
    plan: z.string().min(1),
    approval: z.string().min(1),
    supporting: z.array(z.string().min(1)),
  }),
  hashes: z.looseObject({
    spec: z.string().regex(/^[0-9a-f]{64}$/),
    plan: z.string().regex(/^[0-9a-f]{64}$/),
    approval: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  approvals: z.array(ApprovalDecisionSchema),
  createdBy: ActorSchema,
  createdAt: TimestampSchema,
});
export type ArtifactRevision = z.output<typeof ArtifactRevisionSchema>;

export const ExecutionUnitSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: UnitIdSchema,
  workItemId: WorkItemIdSchema,
  revisionId: RevisionIdSchema,
  taskIds: uniqueStringArray(TaskIdSchema, 1),
  goal: z.string().min(1),
  state: ExecutionUnitStateSchema,
  dependencies: uniqueStringArray(UnitIdSchema),
  conflictKeys: uniqueStringArray(z.string().min(1)),
  expectedChangedAreas: z.array(z.string().min(1)),
  pullRequestGroup: z.string().min(1),
  stackParentUnitId: UnitIdSchema.optional(),
  requiredCapabilities: uniqueStringArray(CapabilitySchema),
  expectedEvidenceIds: uniqueStringArray(EvidenceIdSchema, 1),
});
export type ExecutionUnit = z.output<typeof ExecutionUnitSchema>;

export const AttemptSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: AttemptIdSchema,
  unitId: UnitIdSchema,
  host: HostSchema,
  workerId: WorkerIdSchema,
  hostSessionId: z.string().min(1),
  machineId: MachineIdSchema,
  worktreePath: z.string().min(1),
  leaseExpiresAt: TimestampSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
  replayClass: ReplayClassSchema,
  usage: z.record(z.string(), z.number().nonnegative()),
  outputReferences: z.array(z.string().min(1)),
  interruptionSafety: z.string().min(1),
});
export type Attempt = z.output<typeof AttemptSchema>;

export const PullRequestRefSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  unitId: UnitIdSchema,
  forge: z.literal("github"),
  repository: z.string().min(1),
  number: z.int().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  headSha: GitShaSchema,
  baseSha: GitShaSchema,
  stackPosition: z.int().nonnegative(),
  observedStatus: z.string().min(1),
});
export type PullRequestRef = z.output<typeof PullRequestRefSchema>;

export const EvidenceCategorySchema = z.enum([
  "repository_checks",
  "product_behavior",
  "requirement_coverage",
  "risk_review",
]);
export type EvidenceCategory = z.output<typeof EvidenceCategorySchema>;

export const EvidenceCategoryResultSchema = z.looseObject({
  category: EvidenceCategorySchema,
  status: z.enum(["passed", "failed", "blocked"]),
  receiptIds: z.array(z.string().min(1)).min(1),
});
export type EvidenceCategoryResult = z.output<
  typeof EvidenceCategoryResultSchema
>;

export const EvidenceVerdictSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: VerdictIdSchema,
  unitId: UnitIdSchema,
  requirementIds: uniqueStringArray(z.string().regex(/^R[0-9]+$/), 1),
  evidenceIds: uniqueStringArray(EvidenceIdSchema, 1),
  verifierWorkerId: WorkerIdSchema,
  headSha: GitShaSchema,
  baseSha: GitShaSchema,
  categoryResults: z.array(EvidenceCategoryResultSchema).min(1),
  artifactReferences: z.array(z.string().min(1)),
  verdict: z.enum(["verified", "failed", "blocked"]),
  createdAt: TimestampSchema,
});
export type EvidenceVerdict = z.output<typeof EvidenceVerdictSchema>;

export const HumanGateSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: GateIdSchema,
  workItemId: WorkItemIdSchema,
  unitId: UnitIdSchema.optional(),
  question: z.string().min(1),
  reason: z.string().min(1),
  allowedDecisions: uniqueStringArray(z.string().min(1), 1),
  blockingScope: z.enum(["program", "work_item", "unit"]),
  createdBy: ActorSchema,
  createdAt: TimestampSchema,
  resolution: z
    .looseObject({
      decision: z.string().min(1),
      resolvedAt: TimestampSchema,
      resolvedBy: z.literal("human"),
    })
    .optional(),
});
export type HumanGate = z.output<typeof HumanGateSchema>;

export const PrincipleCandidateSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  workItemId: WorkItemIdSchema,
  proposedSkillName: z.string().regex(/^principle-[a-z0-9-]+$/),
  citedSources: z
    .array(
      z.looseObject({
        path: z.string().min(1),
        excerptHash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1),
  draftArtifactPath: z.string().min(1),
  evaluationStatus: z.enum(["pending", "passed", "failed"]),
  userDecision: z.enum(["pending", "approved", "rejected"]),
});
export type PrincipleCandidate = z.output<typeof PrincipleCandidateSchema>;

export const MachineSchema = z.looseObject({
  schemaVersion: SchemaVersion,
  id: MachineIdSchema,
  label: z.string().min(1),
  capabilities: uniqueStringArray(CapabilitySchema),
  capacity: z.int().min(1),
  lastSeenAt: TimestampSchema,
});
export type Machine = z.output<typeof MachineSchema>;

export const CoreRecordSchemas = {
  stateTransition: StateTransitionSchema,
  project: ProjectSchema,
  workItem: WorkItemSchema,
  artifactRevision: ArtifactRevisionSchema,
  executionUnit: ExecutionUnitSchema,
  attempt: AttemptSchema,
  pullRequest: PullRequestRefSchema,
  evidenceVerdict: EvidenceVerdictSchema,
  humanGate: HumanGateSchema,
  principleCandidate: PrincipleCandidateSchema,
  machine: MachineSchema,
} as const;

/** JSON Schema projections consumed by transport adapters and compatibility tests. */
export const CoreRecordJsonSchemas = {
  stateTransition: z.toJSONSchema(StateTransitionSchema),
  project: z.toJSONSchema(ProjectSchema),
  workItem: z.toJSONSchema(WorkItemSchema),
  artifactRevision: z.toJSONSchema(ArtifactRevisionSchema),
  executionUnit: z.toJSONSchema(ExecutionUnitSchema),
  attempt: z.toJSONSchema(AttemptSchema),
  pullRequest: z.toJSONSchema(PullRequestRefSchema),
  evidenceVerdict: z.toJSONSchema(EvidenceVerdictSchema),
  humanGate: z.toJSONSchema(HumanGateSchema),
  principleCandidate: z.toJSONSchema(PrincipleCandidateSchema),
  machine: z.toJSONSchema(MachineSchema),
} satisfies Record<
  keyof typeof CoreRecordSchemas,
  z.core.JSONSchema.JSONSchema
>;
