# CLAUDE.md

Kriscard Stack opens interactive Pi with a skill-first workflow and an explicit Pi Durable execution backend.

## Boundaries

- `kriscard-mode` routes a request to one playbook.
- `kstack-orchestrator` coordinates from the interactive Pi conversation and invokes the explicit Durable backend for approved execution. Inside that backend, Pi Durable owns worker conversations, scheduling, reporting and recovery.
- Playbooks compose general-purpose skills from `kriscard/Skills`; never copy them here.
- `packages/pi-runner` launches native Pi by default. Only its explicit `durable` command opens a Harness. Keep workflow policy in skills, not TypeScript. Native JSONL sessions and Durable SQLite state remain separate.
- Git, GitHub, project files, and user-approved notes remain the workflow's ordinary sources of truth.
- Follow Pi Durable's coding-agent, background-subagent and recovery examples. Report a demonstrated SDK limitation before proposing extra infrastructure; do not pre-empt hypothetical gaps.

## Commands

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
pnpm run kstack run "<request>"
```
