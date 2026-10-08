# `@kriscard/core`

The pure domain module shared by every Kriscard Stack host and adapter.

It owns:

- versioned record schemas and opaque IDs;
- allowed work-item and execution-unit state changes;
- actor rules for approval, verification, and acceptance;
- execution-graph validation;
- hierarchical budget evaluation;
- exact-commit evidence readiness.

It performs no filesystem, network, Git, process, or UI work. Those effects belong behind later adapter seams.

```bash
pnpm --filter @kriscard/core test
pnpm --filter @kriscard/core typecheck
```
