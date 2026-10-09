# Kriscard Stack

Kriscard Stack is a skill-first engineering workflow inspired by Pstack.

`kriscard-mode` chooses one playbook. The playbook composes the installed skills needed for the work. A small Pi Durable runner keeps one coding agent per working directory resumable across process restarts.

```text
request
  → kriscard-mode
    → one playbook
      → installed skills
        → durable Pi coding agent
          → project files, tests, Git and GitHub
```

There is no custom control plane, planning database, artifact authority, HTTP API, migration system, or worker framework. Those can be added later only when a demonstrated workflow problem requires them.

## Install

```bash
pnpm install
pnpm run build
```

Install the general-purpose skills separately:

```bash
npx skills@latest add kriscard/Skills -g
```

## Run

Choose any provider and tool-capable model supported by `@earendil-works/pi-ai`, with its normal credentials available in the environment:

```bash
export KRISCARD_MODEL="anthropic:claude-sonnet-4-6"
pnpm kriscard -- "Fix the failing checkout test"
```

Run the same command from the same project later to continue its durable conversation. State is stored in one SQLite file per working directory under:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/kriscard-stack/
```

This first version intentionally runs one durable agent. Parallel durable subagents, Claude Code integration, remote APIs, and dashboards wait until the basic workflow proves they are needed.

## Repository

- `skills/dev/kriscard-mode/` — router and playbooks
- `skills/dev/principle-*/` — optional engineering principles
- `packages/pi-runner/` — thin Pi Durable coding-agent runner

## Development

```bash
pnpm run check
```
