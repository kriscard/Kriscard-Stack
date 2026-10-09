---
name: setup-kriscard-stack
description: >-
  Guide Kriscard Stack setup or diagnose a broken installation. Use when installing
  the Stack and general Skills sources, choosing Pi or Claude, checking compatible
  skill versions, configuring a user-provided Stow package, or running doctor.
---

# Setup Kriscard Stack

Help the user choose settings; the CLI checks sources and performs confirmed writes.

## 1. Establish the setup

Ask for the Stack checkout, the compatible general Skills checkout, the initiating
host (Pi or Claude), and plain-skills or runtime mode. Read the Stack checkout's
`config/skills-source.json` to identify the exact required general Skills revision.
If a checkout is missing or incompatible, explain the required revision and stop
before installing or resetting anything.

Ask which installed skill directories the selected host reads, including shared
Skills CLI directories. Supply each explicitly with `--installed-skills`; do not
invent a dotfiles directory. An installed name with different content is a conflict,
not permission to overwrite it. Inspection compares full bundles, including references,
scripts, and assets. Empty or omitted roots block setup, and at least one matching skill
from each source must be installed; installing every available skill is not required.
Use the Skills CLI for a separately approved skill installation from the verified local
checkouts; do not copy reusable skills into Stack.

Ask whether the user wants direct home configuration or a Stow package. Stow requires
an explicit package root supplied by the user. Ask how many days to retain raw logs;
this setting does not authorize deleting approved plans or final evidence.

Complete when the exact source revisions, host, mode, installed roots, destination,
and raw-log retention choice are known.

## 2. Inspect before changing anything

Locate the existing CLI with `kriscard-stack --help`. In a development checkout, use
`node packages/cli/dist/bin.js --help` after its owner has built the CLI. A missing CLI
is a setup blocker, not evidence that runtime capabilities exist.

Run the read-only doctor with the supplied paths:

```sh
kriscard-stack doctor --stack /chosen/Stack --skills /chosen/compatible-Skills --installed-skills /chosen/host-skills
```

Explain each failure and its proposed fix. Optional Docker, simulator, Herdr, or
Tailscale warnings do not authorize installation. Tool detection does not establish
provider authentication or worker-launch readiness. Remote access remains a separate
security decision: doctor can check supplied observations but does not attest live
tailnet policy, enable Serve or Funnel, approve devices, or change grants.

Complete when failures are resolved or reported as blockers and the user understands
which optional capabilities are unavailable.

## 3. Preview, then obtain permission

Preview the chosen configuration with `setup --dry-run`, supplying `--stack`,
`--skills`, each `--installed-skills`, `--mode`, `--host`, and `--retention-days`.
For Stow, also supply `--stow-source`; for an alternate home, supply `--home`.

Show the destination, proposed setting values, warnings, and whether any existing
choices would change. Ask the user to accept those changes before invoking a write.
The CLI itself asks for confirmation in an interactive terminal; noninteractive runs
remain read-only. Do not bypass that confirmation with piped input.

Complete when the user explicitly accepts the exact proposed changes or declines them.

## 4. Confirm the result

After an accepted write, rerun doctor and report the saved settings, any remaining
warnings, and the backup location if an existing configuration changed. A second setup
with identical choices should write nothing. For Stow, report the source path and let
the user apply their chosen package separately; setup does not rewrite home links.

If a file changed during confirmation, a lock is occupied, a path is unsafe, or remote
settings require separate verification, stop and preserve it. Explain the next safe
step rather than deleting locks, loosening permissions, resetting repositories, or
claiming success.

Plain-skills mode does not provide a durable daemon, crash-safe orchestration, worker
launch, or automatic verification. Runtime selection records a preference; it does not
by itself start or configure workers. Credentials belong in Keychain, a host secret
store, or environment injection, never in setup JSON, notes, prompts, or Git.
