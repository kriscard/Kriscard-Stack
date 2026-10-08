import { CoreInvariantError } from "./errors.js";
import type { Actor, HumanGate } from "./schemas.js";

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
  if (Number.isNaN(Date.parse(input.resolvedAt))) {
    throw new CoreInvariantError(
      "INVALID_TRANSITION",
      "Gate resolution requires an ISO-8601 timestamp",
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
