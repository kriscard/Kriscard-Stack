---
name: kstack-orchestrator
description: Coordinate independent Kstack outcomes through Herdr with fresh named durable workers and isolated Git worktrees. Use after kriscard-mode selects orchestration or when the user explicitly asks Kstack to delegate multiple independent outcomes. Do not use for one outcome, tightly coupled changes, or delegation outside Herdr.
---

# Kstack Orchestrator

Coordinate bounded workers; keep execution authority in Pi, Herdr, and Git. Native resumable Pi
sessions are not a Pi Durable SDK integration.

## Visible progress

Show a short `Completed / Active / Queued / Blocked / Cleanup / Next decision` board before discovery,
after launch attempts, at result or blocker transitions, and before returning control. List actual
live names, branches, and session IDs for active workers; queued packets and proposed launches are
not active work. Report an unsuccessful launch immediately with its observed failure and next
required decision. Keep the resource map in the parent's native session and ordinary result packets,
not a new task database.

Every coordination response, including planning-only and blocked responses, includes all six labeled
fields. If the user requests different response sections, nest this board inside that format rather
than dropping it:

```text
Completed: <observed completed outcomes, or none>
Active: <verified live workers with identities, or none>
Queued: <not-yet-launched outcomes, or none>
Blocked: <missing evidence, capability, or authority, or none>
Cleanup: <actual cleanup and retained resources, or none>
Next decision: <required user decision, or none>
```

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

- each worker's single goal and matching playbook file path resolved from the mode's routing table,
  not merely a label such as Feature or Bug fix; the worker confirms its selection;
- read-only or writer classification;
- checkout, worktree, and branch plan;
- real dependencies and conflicts;
- expected evidence and required read, command, and runtime capabilities;
- review/repair round limit, execution budget, and authorized resource cleanup;
- why delegation earns its extra model context.

Normally propose no more than two implementation workers. A larger fan-out requires explicit approval. Herdr owns visible worker processes, so obtain explicit approval to use Herdr when the current request did not already name it.

If the user declines, continue in the parent or serialize the outcomes. Do not treat approval of one topology as permission to create more workers, worktrees, tabs, or workspaces.

Before asking for approval, check that every proposed worker has an existing matching playbook
path and that the six-field progress board is present. Unknown checkout details remain explicitly
unknown rather than invented. Complete when that bounded proposal is approved, or the user declines
and execution returns to one agent.

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
6. record the worker name, Pi session ID, Herdr IDs, cwd, worktree, branch, starting commit, classification, goal, marker, ownership, and cleanup/dependency protections in the parent's Pi session;
7. observe that the intended agent is ready in that exact pane and directory, with the expected session identity, before sending only that worker's task packet;
8. require the worker to report whether its actual tools support the assigned observations before substantive work. Inspection-only tools cannot execute checks; a no-file-tool reviewer needs actual pinned inline source, diff, and rules, not paths alone. Missing required capability is blocked, never passed.

A worker reads the root and nearest applicable `AGENTS.md`, loads only its selected playbook and skills, inspects its assigned repository surface, and stops on a task or design departure. It does not coordinate sibling workers.

Do not place the parent transcript, unrelated discoveries, another worker's complete task, or every installed skill in a task packet.

Complete when every live worker is mapped to one approved outcome, every writer has a distinct
worktree, and observed readiness and tool capabilities support the assigned work. An admitted launch
command is not proof that a worker started or accepted its task.

## 5. Observe without model polling

Use Herdr's mechanical wait and read operations. Do not ask the parent model repeatedly whether a worker is finished. Wait for the task's unique completion marker rather than a reusable Kstack prompt already present in scrollback. A marker means the response reached its required ending; inspect the result packet and repository evidence before treating the task as complete. Let Pi use its supported conversation compaction; do not replace it with a Kstack summary or transcript database.

- A targeted discovery goes only to affected workers as a small amendment to their packet.
- Steering changes tactics inside the accepted goal; a scope, behavior, design, dependency, or ownership change stops the worker and returns to the user or planning.
- A timeout, missing pane, or uncertain submission is inspected against live identity before retry; it does not prove the prompt was absent or authorize a replacement worker.
- A blocked worker is read before any response is sent. Human approval dialogs remain with the user.

If a worker process exits unexpectedly, preserve its worktree and named durable session, report the last observed state, and ask before resuming that same session. Kstack never automatically restarts it.

Complete when each worker produced a bounded result packet or has a reported blocker, deviation, or stopped state.

## 6. Verify and synthesize

Read result packets and repository evidence, not worker transcripts. Reconcile dependencies and conflicts before claiming that outcomes can combine.

For mutating work intended to combine:

1. identify the exact commit for each independent branch or the exact combined commit/diff after an explicitly approved integration;
2. start a fresh verifier conversation;
3. send the verifier expected behavior, applicable `AGENTS.md` rules, exact revision, diff boundaries, required checks, worker evidence, the Review playbook for its checks-only verification role, and applicable domain skill/reference paths; require it to confirm Review and load that guidance before checks, rather than inheriting the author's implementation playbook;
4. exclude implementation conversations and self-certification;
5. treat a changed revision or unavailable observation as stale or blocked, not passed.

Return:

- outcome per worker;
- worktree, branch, and exact commit or diff;
- commands and observed results;
- verifier verdict when required;
- blockers, deviations, and uncertainty;
- the next integration, merge, release, cleanup, or abandonment decision owned by the user.

After checking each result, stop completed task-owned worker processes through the authoritative
Herdr skill while preserving named Pi session history. Merge, release, and destructive cleanup
require explicit user approval; apply any approved cleanup through the gate below.

Complete when the synthesis is bounded, evidence-backed, tied to exact revisions, and leaves
unapproved consequential decisions to the user.

## 7. Clean only proven eligible resources

Before each approved cleanup action, refresh Git, forge, and live Herdr state. Prove task ownership
from the session's resource map and current identity, not a name, age, idle status, or absent agent
detection. Apply these gates:

- **Views/processes:** stop only completed, task-owned workers and close only their approved unused
  panes/tabs/views. Preserve resumable transcripts; never kill Herdr's server or unrelated agents.
- **Worktrees:** remove only clean, inactive, task-owned worktrees. Confirm that no worker occupies
  the checkout, no other task uses it as an input, and no verification still needs it before removal.
  Preserve necessary commits, branches, and evidence. Dirty, unknown, occupied, or dependent worktrees
  remain protected.
- **Branches:** confirm the corresponding PR is merged and the intended outcome is in the target
  branch. Use ancestry when available; a squash merge additionally needs forge revision identity
  and a content/history comparison establishing that no branch-only work would be lost. Failed
  ancestry alone never authorizes force deletion. Protect default/current branches, active checkouts,
  open or stacked PR dependencies, unmerged work, and unrelated branches. If proof is ambiguous,
  retain the branch and ask. Remote deletion requires separate explicit authorization.
- **Main update:** after the relevant PRs are confirmed merged, fetch and fast-forward the clean,
  inactive main checkout. If it is active, dirty, divergent, or checked out elsewhere, report the
  blocker instead of resetting it or switching a user's checkout without approval.

Return what was actually stopped, closed, removed, deleted, already absent, or retained and why.
Complete when every candidate has a fresh eligibility receipt and no protected resource or durable
session history was removed.
