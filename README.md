# Kriscard Stack

Kriscard Stack opens interactive Pi with your engineering skills, principles and playbooks.
Pi Durable is the execution backend used by the orchestration workflow, not the frontend.

```text
kstack → interactive Pi → Kriscard Mode → playbook → relevant skills
                           ↓ when delegated execution is needed
                    kstack-orchestrator → Pi Durable backend → results
```

## Run from this checkout

Requires Node.js 24+, pnpm, macOS or Linux, and Pi installed and configured (`pi` on PATH).

```bash
pnpm install
pnpm run build
pnpm run kstack
```

This opens Pi's normal interface, editor, tools, extensions and session controls. Kriscard Mode
selects the playbook and loads applicable principles and skills. Ordinary tasks stay in that Pi
conversation; they do not open a Durable Harness.

To work in another repository, change to that repository and run the built launcher:

```bash
node /path/to/Kriscard-Stack/packages/pi-runner/dist/bin.js
```

## Native Pi sessions

Pi owns the main conversation and its JSONL session. Native flags pass through unchanged:

```bash
kstack --continue
kstack --resume
kstack run "Fix the failing checkout test"
```

The existing Pi configuration supplies models and credentials. `KRISCARD_MODEL=provider:model-id`
remains an explicit override. Kstack has no separate login or credential store. `kstack pi` is an
alias for the same native frontend.

## Pi Durable execution backend

For approved delegation, `kstack-orchestrator` invokes the explicit backend. The launcher advertises
its absolute command to Pi, so this does not require a global Kstack installation.

```bash
kstack durable run --session /private/path/task.sqlite "<bounded task packet>"
kstack durable --session /private/path/task.sqlite  # resume pending work, without submitting it again
```

The command returns the execution's results when it finishes. This is a foreground command handoff,
not a background notification bridge or a worker panel inside Pi's interface. Inside the backend,
the SDK `subagent` tool supplies persistent workers and result delivery.

Backend storage defaults to `.kstack/session.sqlite`, separate from native Pi's session. Keep
`.kstack/` out of Git; it contains private execution state. Only explicit backend invocation opens it.

The optional backend diagnostic terminal has its own controls (these are not native Pi commands):

- `:quit` closes the Harness, retaining pending work for the next reopen.
- Ctrl+C aborts the main turn; background workers continue.
- `:stop` aborts current main and background work, retaining conversations.
- `:compact` requests SDK compaction.
- EOF waits for current main and background work, then closes the session.

`kstack durable run` waits for backend worker results before exiting. Use one owner process per
SQLite file. Interrupted unsafe tools follow SDK recovery semantics: inspect their effects before
retrying. Closing native Pi does not convert its JSONL history into a Durable session.

## Your workflow

- [Kriscard Mode](skills/dev/kriscard-mode/SKILL.md) selects one of the existing playbooks.
- Principles are indexed in the mode and loaded when their triggers apply.
- General-purpose skills remain owned by `kriscard/Skills` and are discovered through Pi's resource loader.
- [Kstack Orchestrator](skills/dev/kstack-orchestrator/SKILL.md) coordinates from interactive Pi,
  invokes the Durable backend for approved execution, and checks the returned evidence.
  Git branches and worktrees remain ordinary Git resources.
- Project verification uses the project's existing commands and skills. A worker's success message
  is not proof that the behavior works.

Adding skills or playbooks does not require changing TypeScript. Workers read their own checkout's
instructions. This is a trusted local coding runtime, not a sandbox; its tools can read, write and
execute commands with your user permissions. Publishing, merging and destructive cleanup retain
explicit user approval gates.

## Setup

Native histories and older Kstack databases are not converted or deleted automatically. The Durable
backend is not a native-extension compatibility layer. `kriscard` remains an alias for `kstack`.

Once the package is published, `kstack setup` and `kstack update` preview global CLI installation
and skill installation from `kriscard/Skills` and `kriscard/Kriscard-Stack`. They require confirmation
unless `--yes` is supplied, preserve unrelated skills and block conflicting skill ownership.
Herdr is not required. No global installation or settings change occurs during an ordinary run.

## Development

```bash
pnpm run check
pnpm exec oxlint --deny-warnings --format=agent
```

Process tests verify the native Pi handoff without opening Durable state. Backend integration
tests use an isolated local scripted model endpoint with the real CLI, SDK, SQLite, coding tools
and Git worktrees. They test backend execution and SIGKILL/reopen recovery, not model judgment,
a native Pi agent's decision to delegate, or live-provider quality.

The runtime follows Pi Durable's [coding agent](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/25-coding-agent.ts),
[background subagents](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/22-subagent-background.ts)
and [recovery](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/12-recovery.ts)
examples. The experimental SDK is version-pinned; adapt to its installed public API rather than
adding a parallel scheduler, workflow database or provider framework.
