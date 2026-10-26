---
name: kstack-orchestrator
description: Coordinate approved independent outcomes with Pi Durable background workers. Use after kriscard-mode selects orchestration or when the user explicitly requests parallel work. Keep one coherent outcome in the main conversation.
---

# Kstack Orchestrator

The main conversation owns the playbook and integration decisions. Pi Durable owns worker
conversations, task scheduling, result delivery, cancellation and recovery. Git owns source history.

## Choose the work

1. Separate independent outcomes from dependent or conflicting changes. Keep coupled work together.
2. Propose each worker's goal, playbook path, checkout, expected evidence and stop condition.
   Normally use at most two active implementation workers. Obtain approval for delegation unless
   the user's current request already authorizes it.
3. Give concurrent writers distinct Git branches and worktrees using ordinary Git commands.
   Read-only workers may share a checkout. Preserve the caller's worktree and existing changes.
4. Read [Worker contracts](references/worker-contracts.md) and send a bounded task packet, not the
   parent transcript. A worker confirms its playbook and reads the target's applicable instructions.

Proceed when the outcomes, isolation and authority are clear. Otherwise keep work in the main
conversation or ask the one decision that blocks progress.

## Use the runtime

Use the `subagent` tool supplied by Kstack's Pi Durable runtime:

- `spawn`: supply a unique `name`, an existing absolute `cwd`, and the task packet as `message`.
- `send`: supply the existing worker's name and a targeted amendment. This steers current work;
  set `followUp: true` to queue the message after its current answer.
- `status`: inspect worker names, conversation IDs, working directories and busy/idle state.
- `stop`: abort that worker's current work and queued messages. Its conversation remains reusable.

Answers arrive as `[worker <name> result]` follow-up messages. Wait for delivery instead of asking
for status repeatedly. Report launch or tool errors; do not launch replacement workers to hide them.
Workers cannot delegate further.

If `subagent` is unavailable, explain that this requires Kstack's Durable runtime. Native Pi remains
usable for single-agent work; it is not an alternate orchestration backend.

## Check the outcome

Inspect the result and actual repository changes. A worker's success phrase is not evidence.
For code intended to combine, follow the Review playbook: independent review, accepted repairs,
then fresh command-capable verification of the exact candidate. A changed revision invalidates
its affected evidence. Keep checks and findings separate from claims of product behavior.

Return completed outcomes, active workers, blockers, changed paths/revisions, observed checks and
any remaining user decision. Keep progress updates short; include worker identities when useful.
Integration, merging, publication and destructive cleanup require their own explicit authority.

## Pause and recover

Ctrl+C stops only the main turn. `:stop` stops all current task-owned work. `:quit` closes the
Harness without aborting saved work; reopening the same SQLite file resumes pending SDK tasks.
Interrupted unsafe tools are not automatically replayed. Inspect the actual files/Git state before
retrying an effect. Retain dirty worktrees, branches and conversations until cleanup is approved.

This is a trusted local coding runtime, not a sandbox. Read-only assignments and write scopes are
workflow agreements; the standard coding tools do not enforce a security boundary.
