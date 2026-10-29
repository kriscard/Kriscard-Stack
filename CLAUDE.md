# CLAUDE.md

Kriscard Stack launches normal native Pi with Kriscard Mode and bundled workflow skills.

## Boundaries

- `kriscard-mode` selects one playbook. Workflow policy stays in skills, not TypeScript.
- Pi owns the interface, tools, extensions, models and native JSONL session.
- Native `durable_plan`, `durable_implement` and `durable_review` tools compose official SDK examples 26/25/27, with persistence from 12. Keep SDK role state separate from native JSONL.
- Native Pi owns intake, spec gates and repair decisions. Draft submission is not approval; coding requires native confirmation. SDK coding tools do not inherit native permission hooks.
- Background workers and the old command protocol remain unavailable. Extend the approved core-role spec before adding deferred capabilities; preserve old user data.
- General-purpose skills remain owned by `kriscard/Skills`; never copy them here.
- Preserve installer and skill-link ownership safeguards. OpenTUI is only for updates, with plain fallback.
- SSH, Mosh and terminal-session management are external concerns.
- Preserve existing user data and worktrees. Publication and destructive cleanup require explicit authority.

## Commands

```bash
pnpm install
pnpm run check
pnpm run kstack -- --help
pnpm run kstack run "<request>"
```
