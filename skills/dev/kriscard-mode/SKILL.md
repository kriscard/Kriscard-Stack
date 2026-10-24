---
name: kriscard-mode
description: Route engineering work through one Kriscard playbook and the installed skills that fit the job. Use when the user enables Kriscard mode or asks for its feature, bug-fix, refactor, migration, investigation, review, release, or orchestration workflow.
---

# Kriscard Mode

Choose the workflow; let focused skills do the work. The user's request remains the source of scope.

## Route once

Select exactly one playbook from the requested outcome:

| Outcome                                                   | Playbook                                    |
| --------------------------------------------------------- | ------------------------------------------- |
| Add or change product behavior                            | [Feature](playbooks/feature.md)             |
| Correct broken behavior                                   | [Bug fix](playbooks/bug-fix.md)             |
| Improve structure without changing behavior               | [Refactor](playbooks/refactor.md)           |
| Move a dependency, API, data shape, platform, or owner    | [Migration](playbooks/migration.md)         |
| Explain, diagnose, or recommend without changing anything | [Investigation](playbooks/investigation.md) |
| Review an existing artifact or change                     | [Review](playbooks/review.md)               |
| Merge, publish, deploy, or release accepted work          | [Release](playbooks/release.md)             |
| Coordinate several independent outcomes                   | [Orchestration](playbooks/orchestration.md) |

Ask one routing clarification when two routes remain materially plausible. This limit applies only
to choosing the playbook; resolve consequential requirements and design questions within it, using
`grilling` when the user requests a stress test. State the selected playbook, then read it. Each
worker selects one playbook for its own outcome; the parent keeps its coordinating playbook.

## Compose skills

A playbook names the job to perform, not every implementation rule. Load only the installed skills
whose descriptions match the current step and technology. General-purpose expertise belongs to the
separately owned Skills collection; discover installed skills through the host rather than treating
that ownership name as a filesystem path.

For browser-facing frontend work, route ownership, validation and schema trust boundaries, and file
organization to `frontend`. For React work, route component composition, hooks, state, and providers
to `react`. Route native/mobile work to its matching platform skills and actual framework mechanics
to the installed matching framework skill, such as `nextjs-app-architecture` only for Next.js App Router work. Load matching library skills only when their precise branch applies,
and leave these skills unloaded for unrelated tasks.

## Requirements handoff

When a playbook needs consequential requirements or design planning, inspect the installed `spec`
skill's invocation policy. If it is user-only, explain the blocking decision, ask the user to invoke
`/spec` with the bounded brief, and stop implementation until the approved artifacts are supplied.
If model-invocable, use the host's skill mechanism and honor its approval-and-stop boundary. If it is
unavailable, ask whether to resolve the decision in chat or wait for the skill; do not fabricate an
invocation or approved plan. Small, clear changes may proceed directly.

Preserve explicit user gates for destructive actions, publishing, deployment, and merging.

## Durable execution

Pi owns the conversation, tool work, persistence, resume, branching, and compaction. Continue from
that session state. Do not create another control plane, workflow database, artifact store, API, or
migration system. Native saved Pi sessions are not the separate experimental Pi Durable SDK;
a request to adopt that runtime needs its own approved design and implementation scope.

Git, GitHub, project files, tests, and user-approved notes remain the ordinary sources of truth.

## Finish

Return the result, evidence that supports it, remaining uncertainty, and the next decision that only
the user can make. Do not claim work, verification, publication, or merging that did not occur.
