---
name: kriscard-mode
description: Route engineering work through one Kriscard playbook and the installed skills that fit the job. Use when the user enables Kriscard mode or asks for its feature, bug-fix, refactor, migration, investigation, review, pull-request, release, or orchestration workflow.
---

# Kriscard Mode

Choose the workflow; let focused skills do the work. The user's request remains the source of scope.

## Route once

Select exactly one playbook from the requested outcome:

| Outcome                                                                                  | Playbook                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Add or change product behavior                                                           | [Feature](playbooks/feature.md)             |
| Correct broken behavior                                                                  | [Bug fix](playbooks/bug-fix.md)             |
| Improve structure without changing behavior                                              | [Refactor](playbooks/refactor.md)           |
| Move a dependency, API, data shape, platform, or owner                                   | [Migration](playbooks/migration.md)         |
| Explain, diagnose, or recommend without changing anything                                | [Investigation](playbooks/investigation.md) |
| Review an existing artifact or change                                                    | [Review](playbooks/review.md)               |
| Prepare, open, update, or recover a PR; merge, publish, deploy, or release accepted work | [Release](playbooks/release.md)             |
| Coordinate several independent outcomes                                                  | [Orchestration](playbooks/orchestration.md) |

Ask one routing clarification when two routes remain materially plausible. This limit applies only
to choosing the playbook; resolve consequential requirements and design questions within it, using
`grilling` when the user requests a stress test. State the selected playbook, then read it. Each
worker selects one playbook for its own outcome; the parent keeps its coordinating playbook.

## Principles

Read this index at task start. Load the full principle only when current evidence matches its trigger:

| When                                                                                          | Principle                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A feature request prescribes a solution without establishing the underlying user problem      | [Verify the problem](../principle-verify-the-problem/SKILL.md)                             |
| Choosing between proposed work when timing and user impact could change the order             | [Prioritize outcomes now](../principle-prioritize-outcomes-now/SKILL.md)                   |
| Planning uncertain product work whose feedback would wait until the whole project is complete | [Scope for useful feedback](../principle-scope-for-feedback/SKILL.md)                      |
| Work crosses an ownership or responsibility boundary                                          | [Boundary discipline](../principle-boundary-discipline/SKILL.md)                           |
| Preparing or changing PR grouping                                                             | [One goal per PR](../principle-one-goal-per-pull-request/SKILL.md)                         |
| Verification depends on a particular revision                                                 | [Evidence follows the commit](../principle-evidence-follows-the-commit/SKILL.md)           |
| A handoff contains broad history or unrelated material                                        | [Minimize context](../principle-minimize-context/SKILL.md)                                 |
| Acceptance requires behavior on a real surface                                                | [Prove real behavior](../principle-prove-real-behavior/SKILL.md)                           |
| Implementation departs from an approved plan                                                  | [Stop on plan drift](../principle-stop-on-plan-drift/SKILL.md)                             |
| A feature or fix raises a concrete design question in its affected responsibility             | [Invest in design](../principle-invest-in-design/SKILL.md)                                 |
| Choosing the shape of a new or materially extended mechanism                                  | [Develop complete capabilities](../principle-build-the-abstraction/SKILL.md)               |
| Creating or changing an interface with non-obvious caller guarantees, effects, or invariants  | [Describe interfaces first](../principle-describe-interfaces-first/SKILL.md)               |
| Adding error handling for a condition that may be normal, idempotent, or preventable          | [Eliminate avoidable error states](../principle-eliminate-avoidable-error-states/SKILL.md) |
| Proposing a competing convention within an established category                               | [Change conventions completely](../principle-change-conventions-completely/SKILL.md)       |

## Compose skills

A playbook names the job to perform, not every implementation rule. Before performing a step, read
and apply the full `SKILL.md` of each installed skill whose description matches its work and technology.
General-purpose expertise belongs to the separately owned Skills collection; discover installed skills
through the host rather than treating that ownership name as a filesystem path.

General skills own workflow, architecture, test scope, review process, and evidence. Route
native/mobile work to its matching platform skills and actual framework mechanics to the installed
matching framework skill, such as `nextjs-app-architecture` only for Next.js App Router work.

Matching library specialists own installed-version and versioned library facts. Load one only when
its precise branch applies, and leave it unloaded when no installed skill matches the dependency or
the task does not depend on library-specific behavior.

Use these conditional routes when the corresponding work is present; the selected skill owns the
implementation rules and version checks:

- For explicitly requested PR preparation, creation, updates or recovery, `create-pr` owns the
  workflow through the [Release playbook's PR branch](playbooks/release.md#pull-requests). After
  implementation or orchestration, treat requested PR work as a separate outcome; completion alone
  does not authorize it. `code-review` remains the technical review owner.

- `test` owns behavior coverage and test strategy; `playwright` owns Playwright suites and runner
  mechanics, and `msw` owns request interception and handler lifecycle. Use `agent-browser` for
  one-off browser observation rather than treating it as test-suite authoring.
- `frontend` owns browser contracts, validation and schema trust boundaries, file organization,
  design policy, and accessibility; `tailwind` owns Tailwind utilities, themes, source visibility,
  and generated CSS behavior.
- `react` owns React composition, hooks, state, and providers; `tanstack-query` owns Query keys,
  cache lifecycle, invalidation, and mutations when Query behavior is involved.
- `typescript` owns language-wide modeling, narrowing, generics, assertions, and runtime type
  evidence; `zod` owns Zod parsing, transforms, structured errors, and schema contracts when Zod
  behavior is involved.

## Requirements handoff

When a playbook needs consequential requirements or design planning, inspect the installed `spec`
skill's invocation policy. If it is user-only, explain the blocking decision, ask the user to invoke
`spec` with the bounded brief using the host's skill command (`/skill:spec` in Pi), and stop
implementation until the approved artifacts are supplied.
If model-invocable, use the host's skill mechanism and honor its approval-and-stop boundary. If it is
unavailable, ask whether to resolve the decision in chat or wait for the skill; do not fabricate an
invocation or approved plan. Small, clear changes may proceed directly.

Preserve explicit user gates for destructive actions, publishing, deployment, and merging.

## Execution

Kstack opens native Pi with its normal interface, tools, extensions and JSONL session.
This skill and its playbooks own workflow selection. Planning and coordination stay in native Pi.

When `durable_plan` is available, use it for a bounded read-only planning assignment: include the
relevant request, project instructions and artifact references, not this conversation's transcript.
Resolve inaccessible ticket/source input first. Use `resume: true` to recover saved work/history;
a new task keeps the saved model unless explicitly overridden. The SDK proposal is a draft: native
Pi still owns spec files, user discussion and approval gates. Follow the requirements handoff above.

For an explicit implementation request, apply the installed `implement` workflow and validate the
accepted task/artifacts before invoking `durable_implement`. Supply only that approved scope and
relevant instructions. Pi asks for confirmation before coding or resuming coding; refusal or missing
UI is not approval. Return role questions/deviations here instead of expanding the assignment.

For an authorized review, use the installed `code-review` workflow. `durable_review` can perform its
bounded read-only pass with an explicit model and supplied diff/file references. Keep adjudication,
repair authorization and evidence ownership here; request another pass explicitly. Tool availability
does not grant fan-out or independent-review authority that the workflow/user has withheld.

Check actual host capabilities before promising delegation. Background execution is not supplied
by the core roles. SSH and terminal-session management remain external.

Git, GitHub, project files, tests, and user-approved notes remain the ordinary sources of truth.

## Finish

Return the result, evidence that supports it, remaining uncertainty, and the next decision that only
the user can make. Do not claim work, verification, publication, or merging that did not occur.
