# CLAUDE.md

Kriscard Stack is a skill-first engineering workflow with a small Pi Durable host.

## Boundaries

- `kriscard-mode` routes a request to one playbook.
- `kstack-orchestrator` describes approved delegation through the runtime's `subagent` tool. Pi Durable owns the worker conversations, scheduling, reporting and recovery.
- Playbooks compose general-purpose skills from `kriscard/Skills`; never copy them here.
- `packages/pi-runner` connects terminal input/output, Pi resource/model utilities and the documented Pi Durable APIs. Keep workflow policy in skills, not TypeScript. Native Pi is available through `kstack pi`; its sessions remain separate.
- Git, GitHub, project files, and user-approved notes remain the workflow's ordinary sources of truth.
- Follow Pi Durable's coding-agent, background-subagent and recovery examples. Report a demonstrated SDK limitation before proposing extra infrastructure; do not pre-empt hypothetical gaps.

## Commands

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
pnpm run kstack -- run "<request>"
```
