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
| Review existing code or a diff                            | [Review](playbooks/review.md)               |
| Merge, publish, deploy, or release accepted work          | [Release](playbooks/release.md)             |
| Coordinate several independent outcomes                   | [Orchestration](playbooks/orchestration.md) |

Ask one clarification only when two routes remain materially plausible. State the selected playbook,
then read it. Do not combine playbooks into a new process.

## Compose skills

A playbook names the job to perform, not every implementation rule. Load only the installed skills
whose descriptions match the current step and technology. Keep general-purpose expertise in
`kriscard/Skills`; do not copy it into this skill.

Use `/spec` when the work genuinely needs requirements or design decisions. Small, clear changes may
proceed directly. Preserve explicit user gates for destructive actions, publishing, deployment, and
merging.

## Durable execution

Pi owns the conversation, tool work, persistence, resume, branching, and compaction. Continue from
that session state. Do not create another control plane, workflow database, artifact store, API, or
migration system.

Git, GitHub, project files, tests, and user-approved notes remain the ordinary sources of truth.

## Finish

Return the result, evidence that supports it, remaining uncertainty, and the next decision that only
the user can make. Do not claim work, verification, publication, or merging that did not occur.
