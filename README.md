# Kriscard Stack

Kriscard Stack is a skill-first engineering workflow for Pi.

`kstack` opens native Pi with `kriscard-mode` enabled. The mode chooses one playbook, and the playbook composes installed skills. Pi owns the terminal UI, tools, project instructions, conversations, persistence, and resume behavior. Git, GitHub, project files, and user-approved notes remain the ordinary sources of truth.

```text
kstack
  → native Pi session
    → kriscard-mode
      → one playbook
        → installed skills
          → project files, tests, Git and GitHub
```

Kstack has no custom control plane, task database, HTTP API, dashboard, artifact authority, or migration framework.

## Requirements

- macOS
- Node.js 24 or newer
- Pi installed and authenticated
- `npx` for bootstrap and the Skills CLI

Herdr is optional. Ordinary single-agent Kstack works without its CLI.

## Setup

After `@kriscard/kstack` is published, bootstrap it with:

```bash
npx @kriscard/kstack setup
```

Setup discovers the current skills, then previews and confirms these global changes:

- install or update the `@kriscard/kstack` CLI package;
- install all skills from `kriscard/Skills` for Pi;
- install all skills from `kriscard/Kriscard-Stack` for Pi;
- install only the authoritative `herdr` skill from `herdrdev/herdr` for Pi.

It does not target every detected agent, remove unrelated skills, modify `AGENTS.md`, or mutate from `postinstall`. Existing skill names owned by another source block installation.

The Skills CLI may collect anonymous telemetry. Disable it for setup and updates with either variable:

```bash
DO_NOT_TRACK=1 npx @kriscard/kstack setup
# or
DISABLE_TELEMETRY=1 npx @kriscard/kstack setup
```

Use `--yes` only after reviewing the same preview interactively:

```bash
npx @kriscard/kstack setup --yes
```

Update the CLI and rediscover every current skill from the trusted sources with:

```bash
kstack update
```

## Run

Open native Pi with Kriscard mode enabled:

```bash
kstack
```

Then enter an ordinary engineering request:

```text
Build a feature that adds CSV export to the reports page.
```

Kstack passes native Pi options through, so Pi's session workflow remains available:

```bash
kstack --continue
kstack --resume
kstack --name "CSV export"
kstack --session-id csv-export
```

Submit one non-interactive request with Pi's print mode:

```bash
kstack run "Fix the failing checkout test"
```

`kriscard` remains an alias for `kstack`.

Pi selects its configured default model. `KRISCARD_MODEL=<provider>:<model-id>` remains available as an explicit launcher override.

## Sessions

Pi owns session storage, naming, resume, branching, compaction, and deletion. Inside Pi, use `/new`, `/resume`, `/name`, `/session`, `/tree`, `/fork`, and `/compact`. From the shell, use native options such as `--continue`, `--resume`, `--session`, `--session-id`, and `--name` through `kstack`.

Legacy Kstack SQLite session files are not migrated or deleted automatically.

## Repository instructions

Before repository work, Kstack agents read the root `AGENTS.md` when present. Before changing a nested area, they check for a closer `AGENTS.md`. The closest applicable file wins, while the explicit user request remains higher priority.

Kstack consumes these files from the active checkout. Setup and session management never create or modify them.

## Orchestration

Single-agent execution remains the default. `kriscard-mode` selects `kstack-orchestrator` only for explicitly requested or genuinely independent outcomes.

The orchestrator:

- proposes the worker goals and topology before consequential fan-out;
- normally starts no more than two implementation workers;
- loads the authoritative installed `herdr` skill and discovers the live CLI contract;
- gives each worker a fresh named Pi session and one bounded task packet;
- allows read-only workers to share a checkout;
- requires distinct Herdr-managed worktrees and branches for parallel writers;
- waits, reads, steers, and stops workers through Herdr rather than model polling;
- preserves a crashed worker's durable session and worktree without automatically restarting it;
- summarizes bounded result packets rather than copying worker transcripts;
- uses a fresh verifier tied to the exact commit or diff before claiming combined mutating work is ready.

Kstack does not copy the Herdr skill or add a task database, process supervisor, scheduler, runtime adapter, or automatic merge path. Integration, merge, release, branch deletion, and worktree cleanup remain explicit user decisions.

## Rollback

Package and skill installation remain owned by their existing tools:

```bash
npm uninstall --global @kriscard/kstack
npx skills remove kriscard/Skills
npx skills remove kriscard/Kriscard-Stack
npx skills remove herdrdev/herdr
```

Review removal prompts before confirming. Pi sessions, legacy Kstack SQLite files, and Git worktrees are retained.

## Development

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
```

Repository layout:

- `skills/dev/kriscard-mode/` — workflow router and playbooks
- `skills/dev/principle-*/` — optional engineering principles
- `packages/pi-runner/` — publishable Kstack CLI and native Pi launcher
