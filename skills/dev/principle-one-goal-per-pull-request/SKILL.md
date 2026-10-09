---
name: principle-one-goal-per-pull-request
description: >-
  Choose or review pull-request grouping when work may contain multiple outcomes,
  when tasks share files but may remain independently reviewable, or when someone
  proposes changing grouping after plan approval.
---

# One Goal per Pull Request

Use this principle to make pull-request boundaries express reviewable outcomes rather than implementation convenience. A goal is one coherent product or engineering outcome; it may require several tasks, commits, tests, generated files, or documentation changes.

## Activate when

Activate when any of these is true:

- a plan is assigning goals or tasks to tickets, worktrees, branches, or pull requests;
- a proposed pull request contains more than one outcome;
- shared files, ordering, or an intermediate state are being used to justify combining work; or
- implementation discovers pressure to split or combine an approved pull-request group.

## Decision rule

**Give every independently reviewable goal its own ticket, worktree, branch, and pull request; combine goals only when the approved plan records why separation would be unsafe or would not create a meaningful review boundary, and never change approved grouping silently.**

## Apply the rule

1. State each intended outcome without describing its implementation steps.
2. Ask whether each outcome can be reviewed, verified, accepted, reverted, and sequenced independently.
3. Separate independent outcomes even when they touch the same files or one is convenient to implement alongside another.
4. Keep supporting code, tests, generated artifacts, and documentation with one goal when they are necessary to complete and prove that same outcome.
5. If separation creates an unsafe, invalid, or meaningless intermediate state, record that concrete reason in the plan before approval and combine only the inseparable work.
6. After approval, compare actual grouping with the approved task and pull-request group. Stop and return to planning before any split, combination, or added goal that the approval does not cover.

## Limits and counterexamples

- One goal does not mean one file, one commit, or one task. A behavior change and the tests and documentation required to complete it are one goal.
- Touching the same module is not enough reason to combine two bug fixes. Use ordered or stacked pull requests when each fix remains independently meaningful.
- “These changes are small,” “the code was already open,” and “reviewing one PR is faster” are convenience arguments, not unsafe-separation reasons.
- Source and generated output may stay together when reviewing or landing either alone would leave an invalid repository; the plan must say so.
- A prerequisite refactor may be its own goal when it preserves behavior and provides a meaningful review boundary. Sequence it rather than hiding it in a feature pull request.
- An emergency does not erase the approval boundary. If approved grouping must change, stop and obtain an updated plan instead of silently regrouping.

## Observable change

The plan or execution report shows one row per goal with its ticket, worktree, branch, and pull request. Every combined group includes the approved unsafe-separation or no-meaningful-boundary reason. During implementation, a mismatch produces a return-to-planning stop rather than an unapproved grouping change.

## Evaluation cases

| Case        | Facts                                                                                                                                                  | Expected decision                                                   | Why                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OG-Positive | A new export feature and an unrelated cache bug fix are proposed in one pull request because both touch `service.ts`.                                  | Split them into separate goal-shaped pull requests during planning. | Shared files do not remove independent review, verification, or acceptance boundaries. |
| OG-Negative | One approved export behavior needs implementation, tests, generated API output, and user documentation.                                                | Keep the work in one pull request for the single export goal.       | Supporting artifacts complete and prove one outcome; they are not independent goals.   |
| OG-Boundary | A source-schema change and its generated schema cannot be separated without leaving the repository invalid, and the approved plan records that reason. | Keep them in the approved combined pull-request group.              | Separation is unsafe and would not create a meaningful valid review boundary.          |
