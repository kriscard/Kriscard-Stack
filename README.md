# Kriscard Stack

Kriscard Stack is a skill-first engineering workflow with durable Pi conversations.

`kriscard-mode` chooses one playbook, the playbook composes installed skills, and a small CLI runs the work through Pi Durable. Git, GitHub, project files, and user-approved notes remain the ordinary sources of truth.

```text
request
  → named Pi Durable conversation
    → kriscard-mode
      → one playbook
        → installed skills
          → project files, tests, Git and GitHub
```

Kstack has no custom control plane, task database, HTTP API, dashboard, artifact authority, or migration framework.

## Requirements

- macOS
- Node.js 24 or newer
- credentials for a tool-capable model supported by `@earendil-works/pi-ai`
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

## Model

Choose a provider-qualified model:

```bash
export KRISCARD_MODEL="anthropic:claude-sonnet-4-6"
```

## Run

Open the default interactive session:

```bash
kstack
```

Open or create a named interactive session:

```bash
kstack --session checkout
```

Submit one request and exit:

```bash
kstack run --session checkout "Fix the failing checkout test"
```

The former command remains available as an alias, including its one-shot form:

```bash
kriscard "Fix the failing checkout test"
```

## Sessions

Sessions are scoped to the canonical working directory:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/kriscard-stack/<project-hash>/<session>.sqlite
```

Manage sessions from the project they belong to:

```bash
kstack list
kstack new checkout
kstack resume checkout
kstack remove checkout
```

- `new` fails when the name already exists.
- `resume` fails when it does not exist.
- `remove` previews the exact database and requires confirmation; `--yes` is available for reviewed automation.
- names use lowercase letters, numbers, dots, underscores, and hyphens.
- one process owns a session lease at a time; opening and removal use the same lease.
- the small `.lease` coordination file is retained after removal so future openers cannot race destructive cleanup.
- removing the CLI or skills never removes durable sessions.

If a project has a state file from the original one-conversation runner, its default session continues using that file. Kstack does not silently fork, move, or delete it.

## Repository instructions

Before repository work, Kstack agents read the root `AGENTS.md` when present. Before changing a nested area, they check for a closer `AGENTS.md`. The closest applicable file wins, while the explicit user request remains higher priority.

Kstack consumes these files from the active checkout. Setup and session management never create or modify them.

## Rollback

Package and skill installation remain owned by their existing tools:

```bash
npm uninstall --global @kriscard/kstack
npx skills remove kriscard/Skills
npx skills remove kriscard/Kriscard-Stack
npx skills remove herdrdev/herdr
```

Review removal prompts before confirming. Durable SQLite sessions and Git worktrees are retained.

## Development

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
```

Repository layout:

- `skills/dev/kriscard-mode/` — workflow router and playbooks
- `skills/dev/principle-*/` — optional engineering principles
- `packages/pi-runner/` — publishable Kstack CLI and thin Pi Durable runner
