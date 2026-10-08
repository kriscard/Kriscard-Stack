# `@kriscard/core`

The pure domain module shared by every Kriscard Stack host and adapter.

It owns:

- versioned record schemas and opaque IDs;
- allowed work-item and execution-unit state changes;
- actor rules for approval, verification, and acceptance;
- execution-graph validation;
- hierarchical budget evaluation;
- exact unit, expected-evidence, head, and base readiness checks;
- whole-work-item readiness only after every approved unit passes independently;
- atomic, human-only gate resolution.

It performs no filesystem, network, Git, process, or UI work. Those effects belong behind later adapter seams.

See [`TYPE-SAFETY.md`](./TYPE-SAFETY.md) for the package's TypeScript and Zod boundary rules.

```bash
pnpm --filter @kriscard/core test
pnpm --filter @kriscard/core typecheck
```
