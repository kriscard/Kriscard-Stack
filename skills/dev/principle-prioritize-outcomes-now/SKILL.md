---
name: principle-prioritize-outcomes-now
description: >-
  Choose between proposed features, roadmap items, or improvement opportunities
  when timing and user impact could change the order. Use for prioritization
  recommendations, not to reorder or expand already authorized implementation.
---

# Prioritize Outcomes Now

Choose work for its contribution to a current goal, not merely because it will eventually be needed or is easy to build.

## Decision rule

**When recommending what to do next, explain whose outcome each serious candidate changes, whether it removes a blocker or enables valuable behavior, and why doing it now is worth its delivery and ongoing costs.**

## Apply the rule

1. Establish the intended audience, current goal, and relevant decision horizon from available evidence. Ask the decision owner when these are missing and could change the ranking; keep provisional recommendations conditional.
2. For each serious candidate, identify the affected outcome and evidence. Distinguish a blocker that prevents a user from accomplishing it from an enabler that adds valuable capability. An item may do both; a minor inconvenience is not automatically a blocker. Use [Verify the Problem](../principle-verify-the-problem/SKILL.md) when the underlying need is unvalidated.
3. Explain timing: what changes if the work is done now rather than later? Consider current demand, deadlines, dependencies, learning opportunities, and compounding benefits alongside implementation effort, maintenance, support, and complexity.
4. Recommend an order with a short reason for each choice and meaningful deferral. Separate evidence from estimates; identify what new fact would change the order. Retain an existing prioritization method when it serves the decision rather than inventing a scoring system.
5. Return the recommendation to the decision owner. Preserve accepted commitments and execution order unless the user authorizes a change.

## Limits and neighboring owners

- Blockers do not always outrank enablers. A blocker for an out-of-scope audience can matter less than a capability central to the current goal.
- Security, compliance, contractual obligations, reliability, and necessary foundations may justify work before immediate adoption gains. State the obligation or dependency and the consequence of deferral.
- A metric is useful only when it reflects the intended outcome. Without historical data, use an explicit, testable hypothesis rather than fabricated impact scores or revenue forecasts.
- A clear request to implement one accepted feature is not an invitation to reprioritize the roadmap. Concrete contradictions during approved execution belong to [Stop on Plan Drift](../principle-stop-on-plan-drift/SKILL.md).
- `improve` owns codebase opportunity discovery and its ranking workflow; `architect` owns technical alternatives and trade-offs. This principle adds audience and timing checks when their recommendations involve choosing work, not a competing audit or architecture process.

## Observable change

The recommendation distinguishes “valuable eventually” from “worth doing now.” It names the current goal, affected audience, timing, ongoing costs, deferred work, and uncertainty instead of relying solely on feature count, effort, or request volume.

## Evaluation cases

### Positive — eventual need versus current value

**Input:** A small beta already works with Google login. Candidates are additional login methods without reported demand and a fix for onboarding failures affecting invited beta users. The current goal is successful beta activation.

**Expected:** Recommend addressing the demonstrated onboarding blocker first, explain why extra login methods can wait, and name evidence that would change that order. Do not claim additional login methods can never matter.

### Negative — implementation already selected

**Input:** The user asks to implement an approved email-login requirement with settled acceptance criteria and dependencies.

**Expected:** Implement within that authority; do not replace it with another feature or reopen prioritization merely because other work might have higher impact.

### Boundary — obligation before adoption

**Input:** A required security fix competes with a feature expected to improve engagement.

**Expected:** Account for the security obligation and deferral risk rather than demoting the fix for lacking an immediate adoption metric.

### Boundary — enabler can win

**Input:** A blocker affects an unsupported enterprise workflow. An enabler addresses a demonstrated need for the product's current audience and goal.

**Expected:** Evaluate audience fit and timing; do not mechanically put every blocker first. Escalate a change of target audience to the product owner.
