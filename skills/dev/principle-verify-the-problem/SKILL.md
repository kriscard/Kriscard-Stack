---
name: principle-verify-the-problem
description: >-
  Evaluate a feature request that prescribes a solution without establishing the
  underlying user problem. Use during intake, triage, or planning when that gap
  could change what should be built; preserve validated, approved requirements.
---

# Verify the Problem Behind the Request

Treat a requested feature as a proposed solution, not proof of the problem or the right approach.

## Decision rule

**Before recommending or committing to an unvalidated feature solution, establish who has the problem, what they cannot do today, and what outcome would resolve it. Compare solutions against that outcome and the product's intended audience.**

## Apply the rule

1. Separate the requested solution from the underlying problem. Preserve the requester's wording and source when available; distinguish observed difficulty from an inferred need.
2. Inspect available feedback, current behavior, workarounds, and accepted product direction. Establish the affected user, use case, friction, and desired change. A request from a different audience is evidence to assess, not an automatic roadmap commitment.
3. Ask only for missing information that could change the problem or solution. Useful questions are: What are you trying to accomplish? What stops you now? What would be different if this were solved? Label an unverified problem as a hypothesis rather than inventing customer evidence.
4. Compare the requested feature with the smallest viable alternative, including an existing capability when relevant. Recommend the option that addresses the established problem within current constraints; the original request may still be best.
5. Return the problem, supporting evidence or uncertainty, recommended solution, and any decision the user must settle. Resolve consequential requirements through the mode's requirements handoff before implementation.

## Limits and neighboring owners

- A clear, bounded implementation instruction or already validated, approved requirement needs no discovery interview. Reopen it only when concrete evidence contradicts the accepted problem or constraints; use [Stop on Plan Drift](../principle-stop-on-plan-drift/SKILL.md) if execution is already governed by an approved task.
- Urgent incident mitigation can proceed under its existing authority without product discovery. Diagnose broken behavior through the owning debugging workflow.
- Product fit does not authorize replacing requested behavior. Offer alternatives for approval rather than silently implementing a different solution.
- `spec` owns requirements and design artifacts; `architect` owns consequential technical trade-offs. This principle changes how a solution-shaped request is interpreted, not those workflows or their approval gates.
- [Prioritize Outcomes Now](../principle-prioritize-outcomes-now/SKILL.md) decides whether established work matters now; this principle establishes what problem the work would solve.

## Observable change

Instead of accepting a requested feature at face value, the recommendation separates problem from solution, identifies its evidence and audience, and explains why the chosen approach fits. Missing evidence remains explicit. A valid outcome is to keep the requested feature.

## Evaluation cases

### Positive — solution-shaped request

**Input:** A customer requests CSV export, but no use case is supplied. Existing feedback shows they manually copy monthly totals into a report.

**Expected:** Establish the reporting need and remaining unknowns; compare export with existing reporting options before recommending. Preserve the source feedback and ask for approval of any alternative. Do not assume CSV itself is the underlying requirement.

### Negative — validated instruction

**Input:** An approved requirement specifies CSV export for customers whose accounting tool accepts only CSV, with defined fields and acceptance criteria. No contradictory evidence exists.

**Expected:** Execute the authorized requirement without reopening product discovery or substituting a dashboard.

### Boundary — wrong audience

**Input:** An enterprise prospect requests mandatory approval workflows for a product currently aimed at solo creators.

**Expected:** Identify the audience mismatch and establish whether the product owner intends to serve that segment. Do not treat one prospect's request as authority to change direction.

### Boundary — insufficient evidence

**Input:** A request says only “add AI search”; repository inspection cannot establish the user problem.

**Expected:** State the hypothesis and ask what users cannot find today. Stop solution commitment on that missing decision rather than inventing interviews, demand, or a replacement requirement.

## Source provenance

Adapted from Linear Method's [Build with users](https://linear.app/method/build-with-users) and [Manage design projects](https://linear.app/method/manage-design-projects). The request-validation rule does not grant authority to change approved scope.
