import { Type, type Static } from "@sinclair/typebox";

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

export const SchemaVersion = Type.Literal(1);
export const TimestampSchema = Type.String({
  pattern:
    "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$",
});
export const GitShaSchema = Type.String({
  pattern: "^[0-9a-f]{40}(?:[0-9a-f]{24})?$",
});
export const TaskIdSchema = Type.String({ pattern: "^T[0-9]+$" });
export const EvidenceIdSchema = Type.String({ pattern: "^V[0-9]+$" });

export const HostSchema = Type.Union([
  Type.Literal("pi"),
  Type.Literal("claude_code"),
]);
export type Host = Static<typeof HostSchema>;

export const ActorSchema = Type.Union([
  Type.Literal("human"),
  Type.Literal("control_plane"),
  Type.Literal("implementer"),
  Type.Literal("verifier"),
  Type.Literal("system"),
]);
export type Actor = Static<typeof ActorSchema>;

export const WorkItemStateSchema = Type.Union([
  Type.Literal("discovered"),
  Type.Literal("requirements_review"),
  Type.Literal("design_review"),
  Type.Literal("plan_review"),
  Type.Literal("approved"),
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("verifying"),
  Type.Literal("ready_for_human"),
  Type.Literal("accepted"),
  Type.Literal("rejected"),
  Type.Literal("cancelled"),
  Type.Literal("blocked"),
  Type.Literal("deviation"),
  Type.Literal("paused"),
]);
export type WorkItemState = Static<typeof WorkItemStateSchema>;

export const ExecutionUnitStateSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("blocked"),
  Type.Literal("ready"),
  Type.Literal("leased"),
  Type.Literal("running"),
  Type.Literal("deviation"),
  Type.Literal("failed"),
  Type.Literal("implemented"),
  Type.Literal("verifying"),
  Type.Literal("verification_failed"),
  Type.Literal("verified"),
  Type.Literal("ready_for_human"),
  Type.Literal("accepted"),
  Type.Literal("rejected"),
]);
export type ExecutionUnitState = Static<typeof ExecutionUnitStateSchema>;

export const StateTransitionSchema = Type.Object({
  schemaVersion: SchemaVersion,
  subject: Type.Union([
    Type.Literal("work_item"),
    Type.Literal("execution_unit"),
  ]),
  subjectId: Type.Union([WorkItemIdSchema, UnitIdSchema]),
  actor: ActorSchema,
  priorState: Type.Union([WorkItemStateSchema, ExecutionUnitStateSchema]),
  nextState: Type.Union([WorkItemStateSchema, ExecutionUnitStateSchema]),
  reason: Type.String({ minLength: 1 }),
  occurredAt: TimestampSchema,
  idempotencyKey: Type.String({ minLength: 1 }),
});
export type StateTransition = Static<typeof StateTransitionSchema>;

export const ReplayClassSchema = Type.Union([
  Type.Literal("read_only_replayable"),
  Type.Literal("idempotent_with_key"),
  Type.Literal("reconcile_before_retry"),
  Type.Literal("manual_recovery"),
]);
export type ReplayClass = Static<typeof ReplayClassSchema>;

export const CapabilitySchema = Type.Union([
  Type.Literal("git"),
  Type.Literal("github"),
  Type.Literal("pi"),
  Type.Literal("claude_code"),
  Type.Literal("herdr"),
  Type.Literal("tailscale"),
  Type.Literal("obsidian"),
  Type.Literal("qmd"),
  Type.Literal("docker"),
  Type.Literal("ios_simulator"),
]);
export type Capability = Static<typeof CapabilitySchema>;

export const ProjectSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: ProjectIdSchema,
  repositoryFingerprint: Type.String({ minLength: 1 }),
  canonicalRemote: Type.String({ minLength: 1 }),
  localPaths: Type.Array(Type.String({ minLength: 1 })),
  defaultBranch: Type.String({ minLength: 1 }),
  forge: Type.Literal("github"),
  requiredCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
});
export type Project = Static<typeof ProjectSchema>;

export const WorkItemSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: WorkItemIdSchema,
  type: Type.Union([
    Type.Literal("feature"),
    Type.Literal("bug_fix"),
    Type.Literal("refactor"),
    Type.Literal("migration"),
    Type.Literal("investigation"),
    Type.Literal("review"),
    Type.Literal("release"),
    Type.Literal("orchestration"),
  ]),
  source: Type.Object({
    kind: Type.String({ minLength: 1 }),
    reference: Type.Optional(Type.String({ minLength: 1 })),
  }),
  projectId: ProjectIdSchema,
  parentWorkItemId: Type.Optional(WorkItemIdSchema),
  childWorkItemIds: Type.Array(WorkItemIdSchema, { uniqueItems: true }),
  state: WorkItemStateSchema,
  activeRevisionId: Type.Optional(RevisionIdSchema),
  initiatingHost: HostSchema,
  policy: Type.Record(Type.String(), Type.Unknown()),
});
export type WorkItem = Static<typeof WorkItemSchema>;

export const ApprovalDecisionSchema = Type.Object({
  stage: Type.Union([
    Type.Literal("requirements"),
    Type.Literal("technical_design"),
    Type.Literal("plan"),
  ]),
  decision: Type.Literal("approved"),
  method: Type.String({ minLength: 1 }),
  approvedAt: TimestampSchema,
});

export const ArtifactRevisionSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: RevisionIdSchema,
  workItemId: WorkItemIdSchema,
  paths: Type.Object({
    spec: Type.String({ minLength: 1 }),
    plan: Type.String({ minLength: 1 }),
    approval: Type.String({ minLength: 1 }),
    supporting: Type.Array(Type.String({ minLength: 1 })),
  }),
  hashes: Type.Object({
    spec: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    plan: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    approval: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  }),
  approvals: Type.Array(ApprovalDecisionSchema),
  createdBy: ActorSchema,
  createdAt: TimestampSchema,
});
export type ArtifactRevision = Static<typeof ArtifactRevisionSchema>;

export const ExecutionUnitSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: UnitIdSchema,
  workItemId: WorkItemIdSchema,
  taskIds: Type.Array(TaskIdSchema, { minItems: 1, uniqueItems: true }),
  goal: Type.String({ minLength: 1 }),
  state: ExecutionUnitStateSchema,
  dependencies: Type.Array(UnitIdSchema, { uniqueItems: true }),
  conflictKeys: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true,
  }),
  expectedChangedAreas: Type.Array(Type.String({ minLength: 1 })),
  pullRequestGroup: Type.String({ minLength: 1 }),
  stackParentUnitId: Type.Optional(UnitIdSchema),
  requiredCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
  expectedEvidenceIds: Type.Array(EvidenceIdSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
});
export type ExecutionUnit = Static<typeof ExecutionUnitSchema>;

export const AttemptSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: AttemptIdSchema,
  unitId: UnitIdSchema,
  host: HostSchema,
  workerId: WorkerIdSchema,
  hostSessionId: Type.String({ minLength: 1 }),
  machineId: MachineIdSchema,
  worktreePath: Type.String({ minLength: 1 }),
  leaseExpiresAt: TimestampSchema,
  startedAt: TimestampSchema,
  endedAt: Type.Optional(TimestampSchema),
  replayClass: ReplayClassSchema,
  usage: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
  outputReferences: Type.Array(Type.String({ minLength: 1 })),
  interruptionSafety: Type.String({ minLength: 1 }),
});
export type Attempt = Static<typeof AttemptSchema>;

export const PullRequestRefSchema = Type.Object({
  schemaVersion: SchemaVersion,
  unitId: UnitIdSchema,
  forge: Type.Literal("github"),
  repository: Type.String({ minLength: 1 }),
  number: Type.Integer({ minimum: 1 }),
  branch: Type.String({ minLength: 1 }),
  baseBranch: Type.String({ minLength: 1 }),
  headSha: GitShaSchema,
  baseSha: GitShaSchema,
  stackPosition: Type.Integer({ minimum: 0 }),
  observedStatus: Type.String({ minLength: 1 }),
});
export type PullRequestRef = Static<typeof PullRequestRefSchema>;

export const EvidenceCategorySchema = Type.Union([
  Type.Literal("repository_checks"),
  Type.Literal("product_behavior"),
  Type.Literal("requirement_coverage"),
  Type.Literal("risk_review"),
]);
export type EvidenceCategory = Static<typeof EvidenceCategorySchema>;

export const EvidenceCategoryResultSchema = Type.Object({
  category: EvidenceCategorySchema,
  status: Type.Union([
    Type.Literal("passed"),
    Type.Literal("failed"),
    Type.Literal("blocked"),
  ]),
  receiptIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});
export type EvidenceCategoryResult = Static<
  typeof EvidenceCategoryResultSchema
>;

export const EvidenceVerdictSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: VerdictIdSchema,
  unitId: UnitIdSchema,
  requirementIds: Type.Array(Type.String({ pattern: "^R[0-9]+$" }), {
    minItems: 1,
    uniqueItems: true,
  }),
  evidenceIds: Type.Array(EvidenceIdSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  verifierWorkerId: WorkerIdSchema,
  headSha: GitShaSchema,
  baseSha: Type.Optional(GitShaSchema),
  categoryResults: Type.Array(EvidenceCategoryResultSchema, { minItems: 1 }),
  artifactReferences: Type.Array(Type.String({ minLength: 1 })),
  verdict: Type.Union([
    Type.Literal("verified"),
    Type.Literal("failed"),
    Type.Literal("blocked"),
  ]),
  createdAt: TimestampSchema,
});
export type EvidenceVerdict = Static<typeof EvidenceVerdictSchema>;

export const HumanGateSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: GateIdSchema,
  workItemId: WorkItemIdSchema,
  unitId: Type.Optional(UnitIdSchema),
  question: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
  allowedDecisions: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
  blockingScope: Type.Union([
    Type.Literal("program"),
    Type.Literal("work_item"),
    Type.Literal("unit"),
  ]),
  createdBy: ActorSchema,
  createdAt: TimestampSchema,
  resolvedAt: Type.Optional(TimestampSchema),
  resolution: Type.Optional(Type.String({ minLength: 1 })),
  resolvedBy: Type.Optional(Type.Literal("human")),
});
export type HumanGate = Static<typeof HumanGateSchema>;

export const PrincipleCandidateSchema = Type.Object({
  schemaVersion: SchemaVersion,
  workItemId: WorkItemIdSchema,
  proposedSkillName: Type.String({ pattern: "^principle-[a-z0-9-]+$" }),
  citedSources: Type.Array(
    Type.Object({
      path: Type.String({ minLength: 1 }),
      excerptHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    }),
    { minItems: 1 },
  ),
  draftArtifactPath: Type.String({ minLength: 1 }),
  evaluationStatus: Type.Union([
    Type.Literal("pending"),
    Type.Literal("passed"),
    Type.Literal("failed"),
  ]),
  userDecision: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
});
export type PrincipleCandidate = Static<typeof PrincipleCandidateSchema>;

export const MachineSchema = Type.Object({
  schemaVersion: SchemaVersion,
  id: MachineIdSchema,
  label: Type.String({ minLength: 1 }),
  capabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
  capacity: Type.Integer({ minimum: 1 }),
  lastSeenAt: TimestampSchema,
});
export type Machine = Static<typeof MachineSchema>;

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
