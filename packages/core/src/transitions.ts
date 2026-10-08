import { CoreInvariantError } from "./errors.js";
import {
  TimestampSchema,
  type Actor,
  type ExecutionUnitState,
  type WorkItemState,
} from "./schemas.js";

const workItemTransitions: Record<WorkItemState, readonly WorkItemState[]> = {
  discovered: ["requirements_review", "cancelled"],
  requirements_review: ["design_review", "paused", "cancelled"],
  design_review: ["requirements_review", "plan_review", "paused", "cancelled"],
  plan_review: [
    "requirements_review",
    "design_review",
    "approved",
    "paused",
    "cancelled",
  ],
  approved: ["requirements_review", "queued", "paused", "cancelled"],
  queued: ["running", "blocked", "paused", "cancelled"],
  running: ["verifying", "blocked", "deviation", "paused", "cancelled"],
  verifying: [
    "ready_for_human",
    "running",
    "blocked",
    "deviation",
    "paused",
    "cancelled",
  ],
  ready_for_human: ["accepted", "rejected", "paused", "cancelled"],
  blocked: ["queued", "paused", "cancelled"],
  deviation: [
    "requirements_review",
    "design_review",
    "plan_review",
    "paused",
    "cancelled",
  ],
  paused: [
    "requirements_review",
    "design_review",
    "plan_review",
    "approved",
    "queued",
    "running",
    "verifying",
    "ready_for_human",
    "blocked",
    "deviation",
    "cancelled",
  ],
  accepted: [],
  rejected: [],
  cancelled: [],
};

const executionUnitTransitions: Record<
  ExecutionUnitState,
  readonly ExecutionUnitState[]
> = {
  planned: ["blocked", "ready"],
  blocked: ["planned", "ready"],
  ready: ["blocked", "leased"],
  leased: ["ready", "running", "failed"],
  running: ["deviation", "failed", "implemented"],
  deviation: ["planned", "rejected"],
  failed: ["planned", "rejected"],
  implemented: ["verifying", "failed"],
  verifying: ["verification_failed", "verified", "blocked"],
  verification_failed: ["planned", "rejected"],
  verified: ["verifying", "ready_for_human"],
  ready_for_human: ["verifying", "accepted", "rejected"],
  accepted: [],
  rejected: [],
};

const workItemHumanTransitions = new Set([
  "requirements_review->design_review",
  "design_review->plan_review",
  "plan_review->approved",
  "ready_for_human->accepted",
  "ready_for_human->rejected",
]);

const executionVerifierTransitions = new Set([
  "verifying->verification_failed",
  "verifying->verified",
]);

const executionHumanTransitions = new Set([
  "ready_for_human->accepted",
  "ready_for_human->rejected",
]);

export interface TransitionInput<State extends string> {
  from: State;
  to: State;
  actor: Actor;
  reason: string;
  at: string;
  idempotencyKey: string;
}

export interface TransitionRecord<State extends string>
  extends TransitionInput<State> {
  subject: "work_item" | "execution_unit";
}

export interface WorkItemTransitionInput
  extends TransitionInput<WorkItemState> {
  pausedFrom?: WorkItemState;
  evidenceReadiness?: { ready: boolean };
}

export interface WorkItemTransitionRecord
  extends TransitionRecord<WorkItemState> {
  pausedFrom?: WorkItemState;
}

function requireReasonAndIdentity<State extends string>(
  input: TransitionInput<State>,
): void {
  if (!input.reason.trim()) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "A transition requires a reason",
    );
  }
  if (!input.idempotencyKey.trim()) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "A transition requires an idempotency key",
    );
  }
  if (!TimestampSchema.validate(input.at)) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "A transition requires a canonical UTC timestamp",
    );
  }
}

/** Applies one guarded work-item state transition. */
export function transitionWorkItem(
  input: WorkItemTransitionInput,
): WorkItemTransitionRecord {
  requireReasonAndIdentity(input);
  if (!workItemTransitions[input.from].includes(input.to)) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      `Work item cannot move from ${input.from} to ${input.to}`,
    );
  }

  const key = `${input.from}->${input.to}`;
  if (
    input.from === "paused" &&
    input.to !== "cancelled" &&
    input.pausedFrom !== input.to
  ) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "A paused work item can only resume its recorded pre-pause state",
    );
  }
  if (workItemHumanTransitions.has(key) && input.actor !== "human") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      `${key} requires a human actor`,
    );
  }
  if (input.to === "cancelled" && input.actor !== "human") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      "Cancellation requires a human actor",
    );
  }
  if (key === "verifying->ready_for_human") {
    if (input.actor !== "verifier") {
      throw new CoreInvariantError(
        "UNAUTHORIZED_TRANSITION",
        `${key} requires a verifier actor`,
      );
    }
    if (input.evidenceReadiness?.ready !== true) {
      throw new CoreInvariantError(
        "INVALID_TRANSITION",
        `${key} requires current passing evidence`,
      );
    }
  }

  const { evidenceReadiness: _evidenceReadiness, ...transition } = input;
  const record: TransitionRecord<WorkItemState> = {
    subject: "work_item",
    ...transition,
  };
  return input.to === "paused" ? { ...record, pausedFrom: input.from } : record;
}

/** Applies one guarded execution-unit state transition. */
export function transitionExecutionUnit(
  input: TransitionInput<ExecutionUnitState>,
): TransitionRecord<ExecutionUnitState> {
  requireReasonAndIdentity(input);
  if (!executionUnitTransitions[input.from].includes(input.to)) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      `Execution unit cannot move from ${input.from} to ${input.to}`,
    );
  }

  const key = `${input.from}->${input.to}`;
  if (executionVerifierTransitions.has(key) && input.actor !== "verifier") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      `${key} requires a verifier actor`,
    );
  }
  if (executionHumanTransitions.has(key) && input.actor !== "human") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      `${key} requires a human actor`,
    );
  }
  if (key === "running->implemented" && input.actor !== "implementer") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      `${key} requires an implementer actor`,
    );
  }

  return { subject: "execution_unit", ...input };
}
