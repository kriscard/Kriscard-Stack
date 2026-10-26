# Kriscard Stack

Kriscard Stack runs your engineering skills, principles and playbooks on Pi Durable.

```text
Your request → Kriscard Mode → one playbook → relevant skills → verified result
                               Pi Durable executes and persists the work
```

## Run from this checkout

Requires Node.js 24+, pnpm, macOS or Linux, and an existing Pi model configuration.

```bash
pnpm install
pnpm run build
pnpm run kstack
```

Enter an engineering request. Kriscard Mode selects the playbook, loads applicable principles and
skills, and follows that workflow. The runtime supplies the standard coding tools and persistent
background conversations; it does not implement the playbooks as a state machine.

To work in another repository, change to that repository and run the built launcher:

```bash
node /path/to/Kriscard-Stack/packages/pi-runner/dist/bin.js
```

## Sessions

By default, the current project uses `.kstack/session.sqlite`. Reopening it resumes pending SDK
work. Keep `.kstack/` out of Git in each project: it contains private conversation and execution
state. Use `--session` to keep the database elsewhere if preferred.

```bash
kstack --session /private/path/session.sqlite
kstack --model provider/model-id
kstack run "Fix the failing checkout test"
```

The existing Pi configuration supplies models and credentials. `KRISCARD_MODEL=provider:model-id`
remains an explicit override. Kstack has no separate login or credential store.

Interactive controls:

- `:quit` closes the Harness, retaining pending work for the next reopen.
- Ctrl+C aborts the main turn; background workers continue.
- `:stop` aborts current main and background work, retaining conversations.
- `:compact` requests SDK compaction.
- EOF waits for current main and background work, then closes the session.

`kstack run` also waits for background results before exiting. Use one owner process per SQLite
file. Interrupted unsafe tools follow SDK recovery semantics: inspect their effects before retrying.

## Your workflow

- [Kriscard Mode](skills/dev/kriscard-mode/SKILL.md) selects one of the existing playbooks.
- Principles are indexed in the mode and loaded when their triggers apply.
- General-purpose skills remain owned by `kriscard/Skills` and are discovered through Pi's resource loader.
- [Kstack Orchestrator](skills/dev/kstack-orchestrator/SKILL.md) describes when and how to delegate
  through the `subagent` tool. Git branches and worktrees remain ordinary Git resources.
- Project verification uses the project's existing commands and skills. A worker's success message
  is not proof that the behavior works.

Adding skills or playbooks does not require changing TypeScript. Workers read their own checkout's
instructions. This is a trusted local coding runtime, not a sandbox; its tools can read, write and
execute commands with your user permissions. Publishing, merging and destructive cleanup retain
explicit user approval gates.

## Native Pi and setup

Native Pi remains available, with its original UI, extensions and JSONL sessions:

```bash
kstack pi --continue
kstack pi --resume
```

Native histories and older Kstack databases are not converted or deleted automatically. The Durable
host is not a native-extension compatibility layer. `kriscard` remains an alias for `kstack`.

Once the package is published, `kstack setup` and `kstack update` preview global CLI installation
and skill installation from `kriscard/Skills` and `kriscard/Kriscard-Stack`. They require confirmation
unless `--yes` is supplied, preserve unrelated skills and block conflicting skill ownership.
Herdr is not required. No global installation or settings change occurs during an ordinary run.

## Development

```bash
pnpm run check
pnpm exec oxlint --deny-warnings --format=agent
```

The integration tests use a local scripted model endpoint with the real CLI, SDK, SQLite, coding
tools and Git worktrees. They test workflow wiring and SIGKILL/reopen recovery, not model judgment
or live-provider quality.

The runtime follows Pi Durable's [coding agent](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/25-coding-agent.ts),
[background subagents](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/22-subagent-background.ts)
and [recovery](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/12-recovery.ts)
examples. The experimental SDK is version-pinned; adapt to its installed public API rather than
adding a parallel scheduler, workflow database or provider framework.
