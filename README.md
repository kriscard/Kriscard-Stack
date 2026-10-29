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
node /path/to/Kriscard-Stack/packages/pi-runner/dist/bin.js
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

The bundled native extension supplies three Durable role tools: `durable_plan` for read-only drafts,
`durable_implement` for explicitly approved coding with native confirmation, and `durable_review` for
separate read-only findings. They follow the official examples, not a second orchestration service.
Ask normally in native Pi; there are no worker IDs or job commands to manage.

Each role keeps SDK history in private SQLite storage for the saved native session. New roles use
the selected Pi model; saved roles retain theirs unless explicitly overridden. See the
[runner README](packages/pi-runner/README.md) for resume, configuration and lifecycle limits.
Coding confirmation requires interactive Pi or a confirmation-capable RPC client; print mode can
use the read-only roles. The normal native tools remain Pi's responsibility.

Background/parallel agents are deferred. Old worker commands remain removed and old user data is
untouched; no migration is performed. SSH, Mosh and terminal-session management stay outside Kstack.

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

Checks cover lint, build, role/launcher/installer tests, typechecking and formatting. Role tests use
controlled models, real files/SQLite and actual native Pi, including its confirmation UI protocol.
They do not assess paid-provider model quality or perform user-global installations.
