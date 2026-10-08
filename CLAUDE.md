# CLAUDE.md

Kriscard Stack is a pnpm workspace for product-specific engineering workflow skills and durable runtime packages.

## Boundaries

- Product workflow skills live in `skills/`.
- General-purpose skills remain in `kriscard/Skills`; never copy them here.
- Runtime packages live in `packages/`.
- Host-neutral role contracts live in `agents/`.
- Generated plans, approvals, evidence, and runtime state stay outside this repository.
- Use one independently reviewable goal per pull request.

## Commands

```bash
pnpm install
pnpm run validate
pnpm test
pnpm run typecheck
pnpm run format:check
pnpm run check
```
