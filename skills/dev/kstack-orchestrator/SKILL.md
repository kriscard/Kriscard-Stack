---
name: kstack-orchestrator
description: Coordinate independent Kstack outcomes through Herdr with fresh named durable workers and isolated Git worktrees. Use after kriscard-mode selects orchestration or when the user explicitly asks Kstack to delegate multiple independent outcomes. Do not use for one outcome, tightly coupled changes, or delegation outside Herdr.
---

# Kstack Orchestrator

Coordinate bounded workers; keep execution authority in Pi, Herdr, and Git.

## 1. Prove delegation helps

Keep the work in the parent when one agent can complete it coherently. Delegate only when at least two outcomes can proceed independently without sharing mutable state or repeatedly exchanging discoveries.

Classify each outcome before proposing workers:

- **Read-only:** inspection cannot mutate the checkout or external systems.
- **Writer:** implementation, formatting, generated output, dependency changes, Git changes, or any command that may mutate files.
- **Dependent:** the outcome needs another worker's result or branch first.
- **Conflicting:** outcomes may touch the same mutable area or change the same contract.

Serialize dependent and conflicting outcomes. Read-only workers may share a checkout. Concurrent writers require separate Git worktrees and branches.

Complete when every proposed worker has one independent outcome and the isolation decision is explicit.

## 2. Propose bounded fan-out

Show the user:

- each worker's single goal;
- read-only or writer classification;
- checkout, worktree, and branch plan;
- real dependencies and conflicts;
- expected evidence;
- why delegation earns its extra model context.

Normally propose no more than two implementation workers. A larger fan-out requires explicit approval. Herdr owns visible worker processes, so obtain explicit approval to use Herdr when the current request did not already name it.

If the user declines, continue in the parent or serialize the outcomes. Do not treat approval of one topology as permission to create more workers, worktrees, tabs, or workspaces.

Complete when the user approved the consequential fan-out and topology, or execution returned to one agent.

## 3. Load the operator contract

Load the installed `herdr` skill before any Herdr operation. It is authoritative for environment checks, live CLI discovery, identifiers, panes, worktrees, input, output, waiting, and stopping. Kstack does not copy or cache its commands.

Follow that skill to:

1. verify the caller is inside Herdr;
2. inspect `herdr --help` and only the command groups needed for the approved topology;
3. confirm the installed CLI reports every required capability;
4. parse returned IDs instead of deriving them from focus, layout order, or examples.

If the skill, `HERDR_ENV`, CLI, or a required capability is unavailable, report the exact missing dependency and stop orchestration. Ordinary single-agent Kstack remains available.

Complete when live Herdr capabilities prove the approved topology can be created safely.

## 4. Prepare isolated workers

Before launch, read [Worker contracts](references/worker-contracts.md).

For each approved worker:

1. choose a unique Herdr-safe worker name and a unique lowercase Pi session ID;
2. preserve the current checkout for read-only work;
3. ask Herdr for the approved distinct worktree and branch for a writer;
4. start an interactive `kstack --session-id <id> --name <worker-name>` process in that exact directory through the pane surface described by the live Herdr skill;
5. create a unique completion marker for this task that is absent from current pane output;
6. record the worker name, Pi session ID, Herdr IDs, cwd, worktree, branch, starting commit, classification, goal, and marker in the parent's Pi session;
7. send only that worker's task packet.

A worker reads the root and nearest applicable `AGENTS.md`, loads only its selected playbook and skills, inspects its assigned repository surface, and stops on a task or design departure. It does not coordinate sibling workers.

Do not place the parent transcript, unrelated discoveries, another worker's complete task, or every installed skill in a task packet.

Complete when every live worker is mapped to one approved outcome and every writer has a distinct worktree.

## 5. Observe without model polling

Use Herdr's mechanical wait and read operations. Do not ask the parent model repeatedly whether a worker is finished. Wait for the task's unique completion marker rather than a reusable Kstack prompt already present in scrollback. A marker means the response reached its required ending; inspect the result packet and repository evidence before treating the task as complete. Let Pi use its supported conversation compaction; do not replace it with a Kstack summary or transcript database.

- A targeted discovery goes only to affected workers as a small amendment to their packet.
- Steering changes tactics inside the accepted goal; a scope, behavior, design, dependency, or ownership change stops the worker and returns to the user or planning.
- A timeout or uncertain submission is inspected before retry; it does not prove the prompt was absent.
- A blocked worker is read before any response is sent. Human approval dialogs remain with the user.

If a worker process exits unexpectedly, preserve its worktree and named durable session, report the last observed state, and ask before resuming that same session. Kstack never automatically restarts it.

Complete when each worker produced a bounded result packet or has a reported blocker, deviation, or stopped state.

## 6. Verify and synthesize

Read result packets and repository evidence, not worker transcripts. Reconcile dependencies and conflicts before claiming that outcomes can combine.

For mutating work intended to combine:

1. identify the exact commit for each independent branch or the exact combined commit/diff after an explicitly approved integration;
2. start a fresh verifier conversation;
3. send the verifier expected behavior, applicable `AGENTS.md` rules, exact revision, diff boundaries, required checks, and worker evidence;
4. exclude implementation conversations and self-certification;
5. treat a changed revision or unavailable observation as stale or blocked, not passed.

Return:

- outcome per worker;
- worktree, branch, and exact commit or diff;
- commands and observed results;
- verifier verdict when required;
- blockers, deviations, and uncertainty;
- the next integration, merge, release, cleanup, or abandonment decision owned by the user.

Stop worker processes that are complete while preserving their named durable sessions. Never merge, release, delete worktrees, or remove branches without explicit approval.

Complete when the synthesis is bounded, evidence-backed, tied to exact revisions, and leaves consequential decisions to the user.
