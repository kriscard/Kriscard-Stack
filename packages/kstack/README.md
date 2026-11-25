# @kriscard/kstack

Native Pi with Kriscard Mode and bundled workflow skills.

```bash
kstack
kstack run "Inspect the project without editing files"
kstack --continue
```

The package directory is `packages/kstack`; the published package remains `@kriscard/kstack`, with
`kstack` and `kriscard` commands. Native Pi owns its UI, configured extensions, models and JSONL
session. Workflow policy remains in skills.

## Current boundary

Preserved: native launch, setup/update, update-only Soft Glow, skill synchronization and ownership
safeguards. The previous Durable role implementation and its tests are checkpointed in `16d9ebb`
and removed for a fresh example-based rebuild. No replacement role/runtime is implemented yet.
Saved databases, credentials, sessions and worktrees are not deleted or migrated.

The rebuild should use SDK mechanisms for role configuration, visible foreground activity and
recovery before adding background orchestration. It must not introduce another coordinator,
transport, scheduler or status database. Native Pi retains workflow and approval ownership.
Current upstream examples are design references, not permission to upgrade the installed SDK.

See the [repository README](../../README.md) for setup, updates and repository checks. SSH/Mosh and
terminal-session persistence remain external concerns.
