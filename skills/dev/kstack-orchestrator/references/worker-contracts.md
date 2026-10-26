> **Read this when:** preparing Kstack workers, amending a live worker, collecting results, or launching a verifier.

# Worker contracts

These are bounded Markdown handoffs carried by Pi Durable worker conversations. The SDK delivers results; these packets are instructions, not a second task store.

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
- Assigned outcome and matching playbook path: <one outcome; worker confirms its single playbook>
- Applicable skill/reference candidates: <small explicit set; worker confirms and loads matches>
- Required capabilities and preflight: <actual read/command/runtime tools and readiness evidence>
- Budget: <maximum rounds, execution limit, and stop condition>

## Validation

- Commands or observations: <exact checks>
- Expected evidence: <specific results and revision identity>

## Stop conditions

<scope, design, dependency, conflict, destructive-action, or capability departure>

## Return

Use the result packet below. Do not return a transcript.
```

Before substantive work, the worker confirms the pinned target and that its actual tools can make
the required observations. If not, it returns blocked with the missing capability; a profile label
or requested tool list is not proof. A reviewer without file tools requires actual pinned source,
diff, and rules inline and must label that inspection limit.

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
```

The SDK reporter delivers the completed answer to the main conversation. A status word is not proof. The parent checks the named files, commits, commands, and observations before synthesis.

## Verifier packet

A fresh verifier receives:

```markdown
# Verification task: <combined or independent outcome>

Expected behavior: <falsifiable outcomes>
Repository rules: <applicable AGENTS.md paths>
Selected playbook: Review — checks-only verification of the completed change, not the author's implementation playbook; include its exact path and require confirmation
Applicable skills and reference paths: <explicit guidance to load before checking; confirm matches>
Target revision: <exact commit SHA or bounded diff>
Base revision: <exact base SHA when reviewing a diff>
Accepted quality improvements: <observable interface/caller/structure changes, or not applicable>
Required checks: <commands and real observations, including relevant failure paths>
Worker evidence: <bounded result-packet evidence and artifact paths, not self-certification>
Authority and budget: <allowed checks, isolated environment, execution limits, owned resources>
Failure rule: changed revision/context, missing evidence, or unavailable required surface blocks a pass
Return: verdict, findings, commands, observations, artifacts, and exact verified revision
```

Exclude implementation transcripts and worker self-assessment. Use a fresh verifier distinct from
both the author and any reviewer who proposed the repair. It may inspect repository evidence
independently and must report when the target revision or relevant context changes.

## Review and evidence handoffs

For a coordinated code-review loop, use the Review playbook's execution reference; this packet format
does not authorize fan-out or fixes on its own. Give independent reviewers the same bounded intent,
pinned revision, relevant callers/tests, governing rules, accepted patterns, and all applicable
review axes. Ask for concrete simpler alternatives as well as defects. Preserve their initial
independence, actual model identities, and evidence; do not forward one reviewer's findings to the
other before its first result.

The lead validates findings and records Act on / Consider / Noted / Dismissed with rationale. Only
accepted, authorized corrections go to a writer. A changed revision requires affected re-review and
fresh verification rather than recycling an earlier pass.

Before readiness, the lead audits the verifier's actual artifacts and expectations: do checks reach
the claimed boundary, avoid circular assertions, cover required failures, demonstrate accepted
structural improvements, and match the final revision? A verdict or completion marker alone is not
evidence. Return unsupported claims as missing/blocked; retain genuine partial observations without
claiming the whole workflow passed. Stop at the agreed budget instead of spawning an endless chain
of auditors. Platform actions, cleanup, and runtime changes retain their separate approval gates.
