---
name: principle-boundary-discipline
description: >-
  Keep work with its declared owner when current-task evidence shows a repository,
  package, trust, state, or responsibility boundary could be crossed. Use when a
  requested change would duplicate another owner's artifact, place state on the
  wrong side of a boundary, or combine work with different owners. Do not load for
  ordinary edits that remain inside one authorized boundary.
---

# Boundary Discipline

Keep ownership and state boundaries visible in the implementation rather than repairing them after the work is mixed together.

## Activation gate

Apply this principle only when evidence in the current task identifies both:

1. a declared boundary, such as an approved path, repository owner, package responsibility, trust boundary, or location for runtime/private state; and
2. a proposed or necessary change that would cross, duplicate, or blur that boundary.

The boundary must come from the approved task, repository guidance, an existing ownership contract, or observed repository structure. Do not infer a boundary from directory names alone, load this principle for every multi-file change, or use it to expand the task.

## Decision rule

**Keep each concern with its declared owner; when an outcome spans owners, use an explicit interface or split and hand off the work instead of copying, relocating, or silently sharing ownership.**

Apply the rule before editing:

1. Name the artifact or state, its current declared owner, and the proposed destination.
2. Keep the change inside the authorized owner when that satisfies the task.
3. If another owner must change, separate that increment and require its own authorization. If separation prevents the approved outcome, stop with the exact boundary conflict rather than inventing shared ownership.

## Limits and counterexamples

- Do not activate merely because a coherent change touches several files or modules owned by the same approved task.
- An adapter may cross a process or package boundary through the declared interface; crossing an interface is not permission to copy the other side's implementation.
- Shared concepts do not require shared storage or duplicate source ownership. Prefer identifiers, schemas, or explicit handoffs already authorized by the design.
- An approved ownership migration may move an artifact. Follow its migration and rollback plan; do not preserve an unapproved second active owner.
- Do not manufacture a new package, protocol, repository, or ownership scheme. A missing required boundary decision is a planning blocker.

## Observable changed decision

When this principle materially changes a decision, the output names the boundary evidence and does one of the following:

- excludes an out-of-bound artifact from the change;
- uses the declared interface while preserving both owners;
- splits the work into separately authorized increments; or
- stops because the approved outcome requires an undecided ownership change.

Report it as `Applied principle-boundary-discipline: <boundary evidence> changed <proposed action> to <bounded action or stop>.` Do not report the principle when it did not change the decision.

## Evaluation cases

| Kind     | Current-task evidence                                                                                                                                                          | Activate | Required decision                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive | The task asks Stack to reuse a general Skills workflow, and repository guidance says general skills remain owned by `kriscard/Skills`.                                         | yes      | Reference the general skill by name; do not copy it into Stack.                                                                                      |
| Negative | One approved Stack-owned skill needs coordinated edits to its `SKILL.md` and a local evaluation file, both inside the assigned task boundary.                                  | no       | Treat the edits as one bounded change; do not split them merely because two files change.                                                            |
| Boundary | One request contains a Stack-owned principle change and a required change to a general skill in `kriscard/Skills`, but authorization covers only the Stack repository portion. | yes      | Implement only the authorized Stack increment and hand off or return to planning for the separately owned general-skill change; do not duplicate it. |
