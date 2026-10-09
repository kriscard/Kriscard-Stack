import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineTask,
  type Harness,
  type TaskRuntime,
} from "@earendil-works/pi-durable";
import {
  RevisionIdSchema,
  WorkItemIdSchema,
  type RevisionId,
} from "@kriscard/core";
import * as z from "zod";

import {
  ArtifactContextSchema,
  type StoredBundle,
  createArtifactStore,
  isArtifactStoreError,
} from "../artifacts/index.js";
import {
  assertSafeRelativePath,
  assertSafeSourceFile,
  canonicalizePotentialPath,
  portablePathKey,
  readFileWithoutFollowingSymlinks,
} from "../artifacts/paths.js";

const SHA256 = /^[0-9a-f]{64}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CANONICAL_PLANNING_FILES = new Set(["spec.md", "plan.md", "approval.md"]);
const PlanningStageSchema = z.enum(["requirements", "design", "plan"]);
const PlanningArtifactContextSchema = ArtifactContextSchema.catchall(z.json());
const PlanningGateReceiptSchema = z.object({
  sha256: z.string().regex(SHA256),
  reviewReference: z.string().regex(REFERENCE),
  approvedAt: z.iso.datetime(),
});
const PlanningGateSchema = z.object({
  stage: PlanningStageSchema,
  status: z.enum([
    "awaiting_review",
    "reviewing",
    "needs_reconciliation",
    "approved",
  ]),
  reviewReference: z.string().regex(REFERENCE).nullable(),
  receipt: PlanningGateReceiptSchema.nullable(),
});

/** Validates the complete JSON-compatible state persisted by Pi Durable. */
export const PlanningRunSchema = z.object({
  revisionId: RevisionIdSchema,
  context: PlanningArtifactContextSchema,
  sourceDirectory: z.string().min(1),
  supportingFiles: z.array(z.string().min(1)),
  sourceDisposition: z.enum(["preserve", "retire"]).default("preserve"),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  status: z.enum(["planning", "finalizing", "blocked", "approved"]),
  currentStage: z.enum([
    "requirements",
    "design",
    "plan",
    "approval",
    "complete",
  ]),
  gates: z.object({
    requirements: PlanningGateSchema,
    design: PlanningGateSchema,
    plan: PlanningGateSchema,
  }),
  finalizeTaskId: z.int().positive().nullable(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .nullable(),
  artifact: z
    .object({
      reference: z.object({
        kind: z.literal("revision"),
        repositoryFingerprint: z.string().min(1),
        workItemId: WorkItemIdSchema,
        revisionId: RevisionIdSchema,
      }),
      migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
      approvedHashes: z.object({
        spec: z.string().regex(SHA256),
        plan: z.string().regex(SHA256),
        approval: z.string().regex(SHA256),
      }),
    })
    .nullable(),
});

export type PlanningStage = z.output<typeof PlanningStageSchema>;
export type PlanningGateReceipt = z.output<typeof PlanningGateReceiptSchema>;
export type PlanningGate = z.output<typeof PlanningGateSchema>;
export type PlanningGateStatus = PlanningGate["status"];
export type PlanningRun = z.output<typeof PlanningRunSchema>;
const PlanningCommandBase = {
  key: z.string().min(1).max(256),
  expectedVersion: z.int().nonnegative(),
  revisionId: RevisionIdSchema,
};

/** Versioned command boundary shared by local, Pi, and Claude planning clients. */
export const PlanningCommandRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("start"),
    context: PlanningArtifactContextSchema,
    sourceDirectory: z.string().min(1),
    supportingFiles: z.array(z.string().min(1)).optional(),
    sourceDisposition: z.enum(["preserve", "retire"]).optional(),
  }),
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("open_gate"),
    stage: PlanningStageSchema,
    reviewReference: z.string().regex(REFERENCE),
  }),
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("approve_gate"),
    stage: PlanningStageSchema,
    reviewReference: z.string().regex(REFERENCE),
    expectedSha256: z.string().regex(SHA256),
  }),
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("reconcile_gate"),
    stage: PlanningStageSchema,
  }),
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("revise"),
    stage: PlanningStageSchema,
  }),
  z.object({
    ...PlanningCommandBase,
    operation: z.literal("finalize"),
  }),
]);
export type PlanningCommandRequest = z.output<
  typeof PlanningCommandRequestSchema
>;

type PlanningCommandReceipt = {
  operation: PlanningCommandRequest["operation"];
  revisionId: RevisionId;
  identity: string;
  stage: PlanningStage | null;
  version: number;
  taskId: number | null;
};

export type PlanningEvent = {
  position: number;
  revisionId: RevisionId;
  run: PlanningRun;
};

export type PlanningLedger = {
  version: number;
  runs: Record<string, PlanningRun>;
  commands: Record<string, PlanningCommandReceipt>;
  events: PlanningEvent[];
};

const EVENT_LIMIT = 2_048;

export class StalePlanningVersionError extends Error {}
export class PlanningCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const PlanningRuns = defineDoc<PlanningLedger>({
  kind: "kriscard.planning-runs",
  version: 1,
  scope: "session",
  initial: () => ({ version: 0, runs: {}, commands: {}, events: [] }),
});

type ArtifactStore = ReturnType<typeof createArtifactStore>;
type FinalizeInput = { revisionId: RevisionId; migrationId: string };
type FinalizePhase =
  | { phase: "import"; started: boolean }
  | { phase: "retire"; started: boolean };
type FinalizeResult = { migrationId: string };

/** Finalization copies first and records retirement intent before deleting a validated source. */
export function createPlanningFinalizeTask(artifactStore: ArtifactStore) {
  return defineTask<FinalizeInput, FinalizePhase, FinalizeResult>({
    name: "kriscard.planning.finalize",
    version: 1,
    initial: () => ({ phase: "import", started: false }),
    phases: {
      import: async (task, runtime, context) => {
        let request: Parameters<ArtifactStore["importApprovedRevision"]>[0];
        await runtime.commit(async (tx) => {
          const ledger = await tx.doc(PlanningRuns);
          const run = ledger.runs[task.input.revisionId];
          if (
            !run ||
            run.status !== "finalizing" ||
            run.finalizeTaskId !== runtime.taskId ||
            run.migrationId !== task.input.migrationId
          ) {
            throw new Error(
              "Planning finalization does not match its durable run",
            );
          }
          const design = run.gates.design.receipt;
          const plan = run.gates.plan.receipt;
          if (!design || !plan)
            throw new Error("Planning finalization is missing approved gates");
          request = {
            context: PlanningArtifactContextSchema.parse(run.context),
            revisionId: run.revisionId,
            sourceDirectory: run.sourceDirectory,
            supportingFiles: [...run.supportingFiles],
            sourceDisposition: run.sourceDisposition ?? "preserve",
            migrationId: run.migrationId,
            expectedHashes: { spec: design.sha256, plan: plan.sha256 },
          };
          return {
            status: "running",
            checkpoint: { phase: "import", started: true },
          };
        }, context);

        try {
          if (request!.sourceDisposition === "retire") {
            await assertRetirablePlanningSource(request!.sourceDirectory);
          }
          let stored: StoredBundle;
          try {
            stored = await artifactStore.resumeMigration(
              task.input.migrationId,
            );
          } catch (error) {
            if (
              !isArtifactStoreError(error) ||
              error.code !== "MIGRATION_CONFLICT" ||
              !error.message.startsWith("Unknown migration:")
            )
              throw error;
            stored = await artifactStore.importApprovedRevision(request!);
          }
          assertStoredRevisionMatchesRequest(stored, request!);
          if (request!.sourceDisposition === "retire") {
            await runtime.commit(
              () => ({
                status: "running",
                checkpoint: { phase: "retire", started: false },
              }),
              context,
            );
          } else {
            await completeFinalization(
              task.input.revisionId,
              stored,
              runtime,
              context,
            );
          }
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await blockFinalization(
            task.input.revisionId,
            error,
            runtime,
            context,
          );
        }
      },
      retire: async (task, runtime, context) => {
        let sourceDirectory: string | undefined;
        await runtime.commit(async (tx) => {
          const ledger = await tx.doc(PlanningRuns);
          const run = ledger.runs[task.input.revisionId];
          if (
            !run ||
            run.status !== "finalizing" ||
            run.finalizeTaskId !== runtime.taskId ||
            run.migrationId !== task.input.migrationId ||
            run.sourceDisposition !== "retire"
          ) {
            throw new Error(
              "Planning source retirement does not match its durable run",
            );
          }
          sourceDirectory = run.sourceDirectory;
          return {
            status: "running",
            checkpoint: { phase: "retire", started: true },
          };
        }, context);

        try {
          await assertRetirablePlanningSource(sourceDirectory!);
          const stored = await artifactStore.retireMigrationSource(
            task.input.migrationId,
          );
          await completeFinalization(
            task.input.revisionId,
            stored,
            runtime,
            context,
          );
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await blockFinalization(
            task.input.revisionId,
            error,
            runtime,
            context,
          );
        }
      },
    },
    abort: async (task, runtime, context) => {
      await blockFinalization(
        task.input.revisionId,
        new Error(
          "Planning finalization was interrupted; retry to reconcile the existing migration",
        ),
        runtime,
        context,
      );
    },
  });
}

function assertStoredRevisionMatchesRequest(
  stored: StoredBundle,
  request: Parameters<ArtifactStore["importApprovedRevision"]>[0],
): void {
  const manifest = stored.manifest;
  const expectedPaths = [
    "approval.md",
    "plan.md",
    "spec.md",
    ...(request.supportingFiles ?? []).map(
      (sourcePath) => `supporting/${sourcePath}`,
    ),
  ].sort();
  const actualPaths = manifest.files.map((file) => file.path).sort();
  if (
    manifest.kind !== "revision" ||
    manifest.revisionId !== request.revisionId ||
    manifest.context.repositoryFingerprint !==
      request.context.repositoryFingerprint ||
    manifest.context.workItemId !== request.context.workItemId ||
    manifest.context.targetBranch !== request.context.targetBranch ||
    manifest.context.startingCommit !== request.context.startingCommit ||
    manifest.context.taskGroup !== request.context.taskGroup ||
    manifest.context.branch !== request.context.branch ||
    manifest.context.pullRequest !== request.context.pullRequest ||
    manifest.approvedHashes.spec !== request.expectedHashes?.spec ||
    manifest.approvedHashes.plan !== request.expectedHashes?.plan ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  ) {
    throw new Error(
      "Stored planning migration does not match its durable finalization request",
    );
  }
}

async function completeFinalization(
  revisionId: RevisionId,
  stored: StoredBundle,
  runtime: TaskRuntime<FinalizeInput, FinalizePhase, FinalizeResult, object>,
  context: Context,
): Promise<void> {
  await runtime.commit(async (tx) => {
    const ledger = await tx.doc(PlanningRuns);
    const run = requireRun(ledger, revisionId);
    if (run.status !== "finalizing")
      throw new Error("Planning run is no longer finalizing");
    if (stored.manifest.kind !== "revision")
      throw new Error("Planning finalization stored a non-revision bundle");
    run.status = "approved";
    run.currentStage = "complete";
    run.artifact = {
      reference: {
        kind: "revision",
        repositoryFingerprint: run.context.repositoryFingerprint,
        workItemId: run.context.workItemId,
        revisionId: run.revisionId,
      },
      migrationId: stored.migrationId,
      approvedHashes: { ...stored.manifest.approvedHashes },
    };
    run.error = null;
    appendEvent(ledger, run);
    return {
      status: "terminal",
      outcome: {
        status: "completed",
        result: { migrationId: stored.migrationId },
      },
    };
  }, context);
}

async function blockFinalization(
  revisionId: RevisionId,
  error: unknown,
  runtime: TaskRuntime<FinalizeInput, FinalizePhase, FinalizeResult, object>,
  context: Context,
): Promise<void> {
  await runtime.commit(async (tx) => {
    const ledger = await tx.doc(PlanningRuns);
    const run = requireRun(ledger, revisionId);
    run.status = "blocked";
    run.currentStage = "approval";
    run.error = {
      code: isArtifactStoreError(error) ? error.code : "FINALIZATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Planning finalization failed with an unknown error",
    };
    appendEvent(ledger, run);
    return {
      status: "terminal",
      outcome: { status: "failed", error: { message: run.error.message } },
    };
  }, context);
}

export async function submitPlanningCommand(
  harness: Harness,
  finalizeTask: ReturnType<typeof createPlanningFinalizeTask>,
  input: PlanningCommandRequest,
  context: Context = BACKGROUND_CONTEXT,
): Promise<{ version: number; taskId?: number }> {
  input = PlanningCommandRequestSchema.parse(input);
  validateCommon(input);
  const revisionId = input.revisionId;
  const root = await harness.root(context);
  const initialLedger = await harness.snapshot(PlanningRuns, context);
  const initialReceipt = initialLedger?.commands[input.key];
  if (initialReceipt) {
    assertSameCommand(initialReceipt, input);
    return {
      version: initialReceipt.version,
      ...(initialReceipt.taskId === null
        ? {}
        : { taskId: initialReceipt.taskId }),
    };
  }

  let startSourceDirectory: string | undefined;
  let startSupportingFiles: string[] | undefined;
  let startSourceDisposition: "preserve" | "retire" | undefined;
  if (input.operation === "start") {
    startSourceDirectory = canonicalizePotentialPath(input.sourceDirectory);
    startSourceDisposition = input.sourceDisposition ?? "preserve";
    if (startSourceDisposition === "retire") {
      await assertRetirablePlanningSource(startSourceDirectory);
    }
    startSupportingFiles = await validateSupportingFiles(
      startSourceDirectory,
      input.supportingFiles ?? [],
    );
  }

  let approvedHash: string | undefined;
  if (input.operation === "approve_gate") {
    if (!SHA256.test(input.expectedSha256))
      throw new PlanningCommandError(
        "INVALID_HASH",
        "Planning approval requires a lowercase SHA-256 hash",
      );
    const run = initialLedger?.runs[revisionId];
    if (!run)
      throw new PlanningCommandError("RUN_NOT_FOUND", "Unknown planning run");
    approvedHash = await hashStageFile(run, input.stage);
    if (approvedHash !== input.expectedSha256)
      throw new PlanningCommandError(
        "HASH_MISMATCH",
        "The reviewed file changed before its gate approval was recorded",
      );
  }

  const result = await root.commit(async (tx) => {
    const ledger = await tx.doc(PlanningRuns);
    const existing = ledger.commands[input.key];
    if (existing) {
      assertSameCommand(existing, input);
      return {
        version: existing.version,
        ...(existing.taskId === null ? {} : { taskId: existing.taskId }),
      };
    }
    if (ledger.version !== input.expectedVersion)
      throw new StalePlanningVersionError("Planning state version changed");

    let taskId: number | undefined;
    if (input.operation === "start") {
      if (ledger.runs[revisionId])
        throw new PlanningCommandError(
          "RUN_EXISTS",
          "A planning run already exists for this revision",
        );
      const run: PlanningRun = {
        revisionId,
        context: PlanningArtifactContextSchema.parse(input.context),
        sourceDirectory: startSourceDirectory!,
        supportingFiles: startSupportingFiles!,
        sourceDisposition: startSourceDisposition!,
        migrationId: migrationIdFor(revisionId),
        status: "planning",
        currentStage: "requirements",
        gates: {
          requirements: gate("requirements"),
          design: gate("design"),
          plan: gate("plan"),
        },
        finalizeTaskId: null,
        error: null,
        artifact: null,
      };
      ledger.runs[revisionId] = run;
      appendEvent(ledger, run);
    } else {
      const run = requireRun(ledger, revisionId);
      if (run.status === "approved")
        throw new PlanningCommandError(
          "RUN_APPROVED",
          "Approved planning runs are immutable",
        );
      switch (input.operation) {
        case "open_gate":
          openGate(run, input.stage, input.reviewReference);
          appendEvent(ledger, run);
          break;
        case "approve_gate":
          approveGate(run, input.stage, input.reviewReference, approvedHash!);
          appendEvent(ledger, run);
          break;
        case "reconcile_gate":
          reconcileGate(run, input.stage);
          appendEvent(ledger, run);
          break;
        case "revise":
          revise(run, input.stage);
          appendEvent(ledger, run);
          break;
        case "finalize":
          ensureFinalizable(run);
          taskId = await tx.createTask(
            finalizeTask,
            { revisionId, migrationId: run.migrationId },
            { ownership: { kind: "conversation" } },
          );
          run.status = "finalizing";
          run.finalizeTaskId = taskId;
          run.error = null;
          appendEvent(ledger, run);
          break;
      }
    }
    const receipt: PlanningCommandReceipt = {
      operation: input.operation,
      revisionId,
      identity: commandIdentity(input),
      stage:
        input.operation === "open_gate" ||
        input.operation === "approve_gate" ||
        input.operation === "reconcile_gate" ||
        input.operation === "revise"
          ? input.stage
          : null,
      version: ledger.version,
      taskId: taskId ?? null,
    };
    ledger.commands[input.key] = receipt;
    return {
      version: receipt.version,
      ...(taskId === undefined ? {} : { taskId }),
    };
  }, context);
  harness.resume();
  return result;
}

/** Converts in-progress external reviews into an explicit reconciliation wait after restart. */
export async function recoverInterruptedPlanningReviews(
  harness: Harness,
  context: Context = BACKGROUND_CONTEXT,
): Promise<void> {
  const root = await harness.root(context);
  await root.commit(async (tx) => {
    const ledger = await tx.doc(PlanningRuns);
    for (const run of Object.values(ledger.runs)) {
      if (run.status !== "planning") continue;
      const current =
        run.currentStage === "requirements" ||
        run.currentStage === "design" ||
        run.currentStage === "plan"
          ? run.gates[run.currentStage]
          : undefined;
      if (current?.status === "reviewing") {
        current.status = "needs_reconciliation";
        appendEvent(ledger, run);
      }
    }
    return { status: "completed", result: undefined };
  }, context);
}

function validateCommon(input: PlanningCommandRequest): void {
  if (
    !input.key ||
    input.key.length > 256 ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  )
    throw new PlanningCommandError(
      "INVALID_COMMAND",
      "Planning command key and expected version are invalid",
    );
}

function gate(stage: PlanningStage): PlanningGate {
  return {
    stage,
    status: "awaiting_review",
    reviewReference: null,
    receipt: null,
  };
}

function openGate(
  run: PlanningRun,
  stage: PlanningStage,
  reviewReference: string,
): void {
  assertPlanningStage(run, stage);
  if (!REFERENCE.test(reviewReference))
    throw new PlanningCommandError(
      "INVALID_REVIEW_REFERENCE",
      "Review reference must be a short opaque identifier",
    );
  const current = run.gates[stage];
  if (current.status !== "awaiting_review")
    throw new PlanningCommandError(
      "GATE_NOT_READY",
      "The planning gate is not awaiting review",
    );
  current.status = "reviewing";
  current.reviewReference = reviewReference;
}

function approveGate(
  run: PlanningRun,
  stage: PlanningStage,
  reviewReference: string,
  sha256: string,
): void {
  assertPlanningStage(run, stage);
  const current = run.gates[stage];
  if (
    (current.status !== "reviewing" &&
      current.status !== "needs_reconciliation") ||
    current.reviewReference !== reviewReference
  )
    throw new PlanningCommandError(
      "REVIEW_NOT_RECONCILED",
      "Gate approval must resolve the recorded external review",
    );
  current.status = "approved";
  current.receipt = {
    sha256,
    reviewReference,
    approvedAt: new Date().toISOString(),
  };
  run.currentStage =
    stage === "requirements"
      ? "design"
      : stage === "design"
        ? "plan"
        : "approval";
}

function reconcileGate(run: PlanningRun, stage: PlanningStage): void {
  assertPlanningStage(run, stage);
  const current = run.gates[stage];
  if (current.status !== "needs_reconciliation")
    throw new PlanningCommandError(
      "RECONCILIATION_NOT_REQUIRED",
      "The planning gate does not require reconciliation",
    );
  run.gates[stage] = gate(stage);
}

function revise(run: PlanningRun, stage: PlanningStage): void {
  if (run.status === "finalizing")
    throw new PlanningCommandError(
      "FINALIZATION_ACTIVE",
      "Wait for finalization to finish before revising planning artifacts",
    );
  run.status = "planning";
  run.error = null;
  run.finalizeTaskId = null;
  run.artifact = null;
  if (stage === "requirements") {
    run.gates.requirements = gate("requirements");
    run.gates.design = gate("design");
    run.gates.plan = gate("plan");
    run.currentStage = "requirements";
  } else if (stage === "design") {
    if (run.gates.requirements.status !== "approved")
      throw new PlanningCommandError(
        "UPSTREAM_NOT_APPROVED",
        "Requirements must remain approved before revising Design",
      );
    run.gates.design = gate("design");
    run.gates.plan = gate("plan");
    run.currentStage = "design";
  } else {
    if (run.gates.design.status !== "approved")
      throw new PlanningCommandError(
        "UPSTREAM_NOT_APPROVED",
        "Design must remain approved before revising Plan",
      );
    run.gates.plan = gate("plan");
    run.currentStage = "plan";
  }
}

function assertPlanningStage(run: PlanningRun, stage: PlanningStage): void {
  if (run.status !== "planning" || run.currentStage !== stage)
    throw new PlanningCommandError(
      "STAGE_ORDER",
      `Planning run is at ${run.currentStage}, not ${stage}`,
    );
}

function ensureFinalizable(run: PlanningRun): void {
  if (
    (run.status !== "planning" && run.status !== "blocked") ||
    run.currentStage !== "approval" ||
    Object.values(run.gates).some((value) => value.status !== "approved")
  )
    throw new PlanningCommandError(
      "GATES_INCOMPLETE",
      "Requirements, Design, and Plan must all be approved before finalization",
    );
}

function requireRun(
  ledger: PlanningLedger,
  revisionId: RevisionId,
): PlanningRun {
  const run = ledger.runs[revisionId];
  if (!run)
    throw new PlanningCommandError("RUN_NOT_FOUND", "Unknown planning run");
  return run;
}

function appendEvent(ledger: PlanningLedger, run: PlanningRun): number {
  const position = ledger.version + 1;
  ledger.version = position;
  ledger.events = [
    ...ledger.events,
    { position, revisionId: run.revisionId, run: PlanningRunSchema.parse(run) },
  ].slice(-EVENT_LIMIT);
  return position;
}

function assertSameCommand(
  existing: PlanningCommandReceipt,
  input: PlanningCommandRequest,
): void {
  const inputStage =
    input.operation === "open_gate" ||
    input.operation === "approve_gate" ||
    input.operation === "reconcile_gate" ||
    input.operation === "revise"
      ? input.stage
      : null;
  if (
    existing.operation !== input.operation ||
    existing.revisionId !== input.revisionId ||
    existing.stage !== inputStage ||
    existing.identity !== commandIdentity(input)
  )
    throw new PlanningCommandError(
      "KEY_CONFLICT",
      "Planning idempotency key belongs to another command",
    );
}

function commandIdentity(input: PlanningCommandRequest): string {
  switch (input.operation) {
    case "start":
      return JSON.stringify({
        operation: input.operation,
        revisionId: input.revisionId,
        context: input.context,
        sourceDirectory: input.sourceDirectory,
        supportingFiles: input.supportingFiles ?? [],
        sourceDisposition: input.sourceDisposition ?? "preserve",
      });
    case "open_gate":
      return JSON.stringify({
        operation: input.operation,
        revisionId: input.revisionId,
        stage: input.stage,
        reviewReference: input.reviewReference,
      });
    case "approve_gate":
      return JSON.stringify({
        operation: input.operation,
        revisionId: input.revisionId,
        stage: input.stage,
        reviewReference: input.reviewReference,
        expectedSha256: input.expectedSha256,
      });
    case "reconcile_gate":
    case "revise":
      return JSON.stringify({
        operation: input.operation,
        revisionId: input.revisionId,
        stage: input.stage,
      });
    case "finalize":
      return JSON.stringify({
        operation: input.operation,
        revisionId: input.revisionId,
      });
  }
}

async function assertRetirablePlanningSource(
  sourceDirectory: string,
): Promise<void> {
  const slug = path.basename(sourceDirectory);
  const specsDirectory = path.dirname(sourceDirectory);
  const docsDirectory = path.dirname(specsDirectory);
  const repositoryDirectory = path.dirname(docsDirectory);
  const hasPlanningShape =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    path.basename(specsDirectory) === "specs" &&
    path.basename(docsDirectory) === "docs";

  let gitMarkerIsSafe = false;
  if (hasPlanningShape) {
    try {
      const marker = await lstat(path.join(repositoryDirectory, ".git"));
      gitMarkerIsSafe =
        !marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile());
    } catch {
      gitMarkerIsSafe = false;
    }
  }
  if (!hasPlanningShape || !gitMarkerIsSafe) {
    throw new PlanningCommandError(
      "INVALID_SOURCE_RETIREMENT",
      "Source retirement requires an explicit repository-local docs/specs/<slug> planning directory",
    );
  }
}

async function validateSupportingFiles(
  sourceDirectory: string,
  supportingFiles: readonly string[],
): Promise<string[]> {
  const validated: string[] = [];
  const keys = new Set<string>();
  try {
    for (const supportingFile of supportingFiles) {
      const safePath = assertSafeRelativePath(supportingFile);
      const key = portablePathKey(safePath);
      if (CANONICAL_PLANNING_FILES.has(key)) {
        throw new PlanningCommandError(
          "INVALID_SUPPORTING_FILE",
          `Supporting file collides with a canonical planning artifact: ${safePath}`,
        );
      }
      if (keys.has(key)) {
        throw new PlanningCommandError(
          "INVALID_SUPPORTING_FILE",
          `Duplicate supporting file path: ${safePath}`,
        );
      }
      await assertSafeSourceFile(sourceDirectory, safePath);
      keys.add(key);
      validated.push(safePath);
    }
  } catch (error) {
    if (error instanceof PlanningCommandError) throw error;
    throw new PlanningCommandError(
      "INVALID_SUPPORTING_FILE",
      error instanceof Error ? error.message : "Invalid supporting file path",
    );
  }
  return validated;
}

async function hashStageFile(
  run: PlanningRun,
  stage: PlanningStage,
): Promise<string> {
  const fileName = stage === "plan" ? "plan.md" : "spec.md";
  const filePath = await assertSafeSourceFile(run.sourceDirectory, fileName);
  const bytes = await readFileWithoutFollowingSymlinks(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function migrationIdFor(revisionId: RevisionId): string {
  return `planning-${createHash("sha256").update(revisionId).digest("hex").slice(0, 24)}`;
}
