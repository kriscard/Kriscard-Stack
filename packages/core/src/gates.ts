import { CoreInvariantError } from "./errors.js";
import { TimestampSchema, type Actor, type HumanGate } from "./schemas.js";

/** Atomically records one allowed human decision on an unresolved gate. */
export function resolveHumanGate(input: {
  gate: HumanGate;
  decision: string;
  actor: Actor;
  resolvedAt: string;
}): HumanGate {
  if (input.actor !== "human") {
    throw new CoreInvariantError(
      "UNAUTHORIZED_TRANSITION",
      "Only a human can resolve a human gate",
    );
  }
  if (input.gate.resolution) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "A resolved human gate cannot be resolved again",
    );
  }
  if (!input.gate.allowedDecisions.includes(input.decision)) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      `${input.decision} is not an allowed decision`,
    );
  }
  if (!TimestampSchema.validate(input.resolvedAt)) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "Gate resolution requires a canonical UTC timestamp",
    );
  }

  return {
    ...input.gate,
    resolution: {
      decision: input.decision,
      resolvedAt: input.resolvedAt,
      resolvedBy: "human",
    },
  };
}
