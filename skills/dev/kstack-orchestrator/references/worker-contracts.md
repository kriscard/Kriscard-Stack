> **Read this when:** preparing Kstack workers, amending a live worker, collecting results, or launching a verifier.

# Worker contracts

These are bounded Markdown handoffs carried by separate Pi sessions. They are not schemas, protocol messages, or a second task store.

## Task packet

Send one packet per worker:

```markdown
# Worker task: <single outcome>

## Goal

<one observable outcome>

## Done when

<falsifiable completion condition>

## Accepted context

- Requirements: <only applicable conclusions or IDs>
- Decisions: <only applicable accepted decisions>
- Relevant paths: <bounded paths or subsystem>
- Repository rules: read root and nearest applicable AGENTS.md

## Starting point

- Commit: <full SHA>
- Working directory: <absolute path>
- Worktree: <identity or not applicable — read-only shared checkout>
- Branch: <name or not applicable — read-only>

## Coordination

- Classification: read-only | writer
- Dependencies: <worker/result IDs or none>
- Conflict boundary: <paths/contracts that must remain untouched>
- Selected playbook and skills: <small explicit set>
- Completion marker: `KSTACK_RESULT_<unique-token>`

## Validation

- Commands or observations: <exact checks>
- Expected evidence: <specific results and revision identity>

## Stop conditions

<scope, design, dependency, conflict, destructive-action, or capability departure>

## Return

Use the result packet below. Do not return a transcript.
```

Include a conclusion from the parent only when the worker needs it to complete this goal. Link a repository path, source, or exact commit when the worker can inspect the evidence directly.

Exclude:

- parent conversation history or deliberation;
- unrelated research and discoveries;
- sibling transcripts or complete sibling tasks;
- unused requirements, playbooks, and skills;
- raw logs that can be summarized and referenced;
- permission for integration, merge, release, deployment, or cleanup.

## Targeted amendment

Send a later discovery only to affected workers:

```markdown
# Task amendment

Affected assumption or dependency: <what changed>
Evidence: <path, commit, command result, or user decision>
Required adjustment: <tactic inside the accepted goal>
Stop if: <condition that returns to planning or the user>
```

An amendment cannot expand the goal, authorize a design change, or silently change branch ownership.

## Result packet

Require this completion shape:

```markdown
# Worker result: <outcome>

Status: completed | blocked | deviation | stopped

## Outcome

<what is now true>

## Revision

- Working directory/worktree: <path>
- Branch: <name or not applicable>
- Commit: <full SHA or not committed>
- Changed files: <bounded list or none>

## Evidence

- `<command or observation>` — <observed result>

## Coverage

<done condition and applicable requirements proved or not proved>

## Blockers or deviations

<exact issue and preserved state, or none>

## User decisions

<integration, merge, destructive cleanup, budget, or scope decision, or none>

KSTACK*RESULT*<unique-token>
```

The completion marker must be the final non-empty line and unique to this task so a mechanical wait cannot match stale output. A status word or marker is not proof. The parent checks the named files, commits, commands, and observations before synthesis.

## Verifier packet

A fresh verifier receives:

```markdown
# Verification task: <combined or independent outcome>

Expected behavior: <falsifiable outcomes>
Repository rules: <applicable AGENTS.md paths>
Target revision: <exact commit SHA or bounded diff>
Base revision: <exact base SHA when reviewing a diff>
Required checks: <commands and real observations>
Worker evidence: <bounded result-packet evidence>
Failure rule: changed revision, missing evidence, or unavailable required surface blocks a pass
Return: verdict, findings, commands, observations, and exact verified revision
```

Exclude implementation transcripts and worker self-assessment. A verifier may inspect repository evidence independently and must report when the target revision changes.
