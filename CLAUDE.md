# CLAUDE.md

Kriscard Stack is a skill-first engineering workflow with one small Pi Durable runner.

## Boundaries

- `kriscard-mode` routes a request to one playbook.
- Playbooks compose general-purpose skills from `kriscard/Skills`; never copy them here.
- `packages/pi-runner` only persists and resumes the Pi coding agent.
- Git, GitHub, project files, and user-approved notes remain the workflow's ordinary sources of truth.
- Add runtime infrastructure only after a demonstrated workflow failure requires it.

## Commands

```bash
pnpm install
pnpm run check
pnpm kriscard -- "<request>"
```
