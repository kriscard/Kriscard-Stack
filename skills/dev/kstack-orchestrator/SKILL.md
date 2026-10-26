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

## Invoke the backend from interactive Pi

The interactive Pi conversation owns coordination. Use the exact Pi Durable backend command
advertised in its startup instructions; this works from a checkout without a global Kstack install.
Append `run --session <private-sqlite-path> "<bounded task packet>"` and execute it through Pi's
command tool in the intended repository. The backend performs that approved assignment and
returns its results when the command finishes. Record the database path in the main session.

To resume interrupted backend work, invoke the same command with `--session <same-path>` and
no new task packet. Native Pi's `--resume` and JSONL session are separate from backend recovery.
Do not substitute a native extension's similarly named subagent tool for Pi Durable.

This is a foreground CLI handoff, not a live background notification bridge into Pi's UI. Do not
claim native worker panels, live cross-runtime steering or automatic notification delivery.

## Inside the Pi Durable backend

The backend prompt identifies this host. Here use its SDK `subagent` tool when the assigned work
calls for workers; do not start another backend process:

- `spawn`: supply a unique `name`, an existing absolute `cwd`, and the task packet as `message`.
- `send`: supply the existing worker's name and a targeted amendment. This steers current work;
  set `followUp: true` to queue the message after its current answer.
- `status`: inspect worker names, conversation IDs, working directories and busy/idle state.
- `stop`: abort that worker's current work and queued messages. Its conversation remains reusable.

Answers arrive as `[worker <name> result]` follow-up messages. Wait for delivery instead of asking
for status repeatedly. Report launch or tool errors; do not launch replacement workers to hide them.
Workers cannot delegate further.

If a required backend capability is unavailable, report the missing capability and stop that
assignment. Ordinary work in the interactive Pi frontend remains available.

## Check the outcome

Inspect the result and actual repository changes. A worker's success phrase is not evidence.
For code intended to combine, follow the Review playbook: independent review, accepted repairs,
then fresh command-capable verification of the exact candidate. A changed revision invalidates
its affected evidence. Keep checks and findings separate from claims of product behavior.

Return completed outcomes, active workers, blockers, changed paths/revisions, observed checks and
any remaining user decision. Keep progress updates short; include worker identities when useful.
Integration, merging, publication and destructive cleanup require their own explicit authority.

## Pause and recover

Interactive Pi retains its normal controls. In the backend's diagnostic terminal, Ctrl+C stops only
its main turn, `:stop` stops its current task-owned work, and `:quit` closes the Harness without
aborting saved work. Reopening the same SQLite file resumes pending SDK tasks.
Interrupted unsafe tools are not automatically replayed. Inspect the actual files/Git state before
retrying an effect. Retain dirty worktrees, branches and conversations until cleanup is approved.

This is a trusted local coding runtime, not a sandbox. Read-only assignments and write scopes are
workflow agreements; the standard coding tools do not enforce a security boundary.
