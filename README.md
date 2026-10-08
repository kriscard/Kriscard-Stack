# Kriscard Stack

Kriscard Stack is a personal AI engineering system for planning, implementing, verifying, and shipping software with explicit human approval.

> The project is public but not ready to install. The first release is being built through reviewed, independently verified tasks.

## Repository ownership

Kriscard Stack owns its product workflows and runtime. Reusable engineering and knowledge-management skills remain in [`kriscard/Skills`](https://github.com/kriscard/Skills).

The compatible Skills revision is recorded in [`config/skills-source.json`](config/skills-source.json). CI checks both catalogs together so one skill cannot have two active owners.

## Layout

- `skills/` — product workflow skills and engineering principles
- `agents/` — host-neutral worker and verifier contracts
- `packages/` — core, control plane, CLI, host packages, and integrations
- `config/` — versioned compatibility declarations
- `scripts/` — repository validation

## Development

Requirements: an up-to-date Node.js 24 LTS release (or newer) and pnpm 10 or newer. CI tests both Node 24 LTS and Node 26 Current with Vitest.

```bash
pnpm install
pnpm run check
```

`KRISCARD_SKILLS_REPO` may point catalog validation at a local checkout of `kriscard/Skills`. Without it, validation expects the sibling path `../Skills`.
