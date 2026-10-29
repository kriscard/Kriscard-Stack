# CLAUDE.md

Kriscard Stack launches normal native Pi with Kriscard Mode and bundled workflow skills.

## Boundaries

- `kriscard-mode` selects one playbook. Workflow policy stays in skills, not TypeScript.
- Pi owns the interface, tools, extensions, models and native JSONL session.
- Application code lives in `packages/kstack`; the package/CLI name is unchanged.
- The previous Durable roles are checkpointed in `16d9ebb` and removed for a rebuild. Do not advertise role tools or background execution until replacement behavior is implemented and verified.
- Native Pi owns intake, spec gates and repair decisions. The expanded agent-runtime vision requires new approved scope/design; the core-only spec is historical, not implementation authority.
- Reuse official SDK mechanisms rather than another coordinator, transport or task/status ledger. Preserve old user data.
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
