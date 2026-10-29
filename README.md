# Kriscard Stack

Kriscard Stack opens native Pi with Kriscard Mode, engineering skills and playbooks.
Pi owns the interface, tools, extensions and main conversation.

## Run from this checkout

Requires Node.js 24+, pnpm, macOS or Linux, and Pi installed and configured (`pi` on PATH).

```bash
pnpm install
pnpm run build
pnpm run kstack
```

To work in another repository, change to that repository and run the built launcher:

```bash
node /path/to/Kriscard-Stack/packages/kstack/dist/bin.js
```

Native Pi options pass through:

```bash
kstack --continue
kstack --resume
kstack run "Plan a fix for the failing checkout test without editing files"
```

Pi's existing configuration supplies models and credentials. `KRISCARD_MODEL=provider:model-id`
is an explicit override. `kstack pi` uses the same native frontend; `kriscard` aliases `kstack`.

## Workflow

[Kriscard Mode](skills/dev/kriscard-mode/SKILL.md) chooses one playbook and loads applicable skills
and principles. General-purpose skills remain owned by `kriscard/Skills`.
Planning, questions and approvals stay in the native Pi conversation. Publication, merges and
destructive cleanup require explicit authority.

The previous Durable role integration is checkpointed in commit `16d9ebb` and removed from the
working tree for an example-based rebuild. No Kstack Durable role tools or background workers are
currently loaded. The old core-role spec remains historical; it does not approve the expanded rebuild.

The target is identifiable agents with visible activity, SDK-owned recovery and explicit native-Pi
workflow ownership. Foreground visibility comes before background orchestration. See the
[package README](packages/kstack/README.md) for the current package boundary.

Saved SDK databases, native sessions, credentials and worktrees remain untouched. SSH, Mosh and
terminal-session management stay outside Kstack.

## Setup and updates

`kstack setup` and `kstack update` preview global CLI installation and general-purpose skill
installation from `kriscard/Skills`. They require confirmation unless `--yes` is supplied,
preserve unrelated skills and block conflicting ownership.

Workflow skills ship with the CLI rather than being installed a second time. Existing links into
Kstack's bundled skills are synchronized after setup/update and before launching Pi. Switching Node
installations repoints shared links to the executing bundle; other agents follow the most recently
activated bundle. `kstack sync-skills` performs just this repair. Missing links are not created.
Real directories and links outside Kstack are never overwritten; conflicting older copies require
a separately approved, backed-up migration. Custom `KSTACK_MODE_PATH` locations are not managed.

Only `kstack update` uses the Soft Glow display when the runtime supports it. Setup stays plain.
Pipes, CI, nonempty `NO_COLOR`, `TERM=dumb` and unsupported native rendering use plain output.
`--plain`, `--no-motion` and `--verbose` control update presentation. No command upgrades global Node.

Ordinary launches do not install packages or change settings, but may repair existing Kstack skill
links. Herdr is not required.

## Development

```bash
pnpm run check
pnpm exec oxlint --deny-warnings --format=agent
```

Checks cover lint, build, native-launcher/installer tests, typechecking and formatting. The removed
role-specific tests remain in the checkpoint, not as evidence for a replacement implementation.
Tests do not perform paid-model requests or user-global installations.
