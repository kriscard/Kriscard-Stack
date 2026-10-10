# CLAUDE.md

Kriscard Stack is a skill-first engineering workflow with one small native Pi launcher.

## Boundaries

- `kriscard-mode` routes a request to one playbook.
- `kstack-orchestrator` coordinates approved independent workers through the authoritative installed Herdr skill; it does not own Herdr commands or process supervision.
- Playbooks compose general-purpose skills from `kriscard/Skills`; never copy them here.
- `packages/pi-runner` owns the thin `kstack` launcher and previewed installation commands; Pi owns its UI, tools, conversations, and session lifecycle.
- Git, GitHub, project files, and user-approved notes remain the workflow's ordinary sources of truth.
- Add runtime infrastructure only after a demonstrated workflow failure requires it.

## Commands

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
pnpm run kstack -- run "<request>"
```
