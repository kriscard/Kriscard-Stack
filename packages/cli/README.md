# `@kriscard/cli` — T6 in progress

The setup and doctor package is under development and is not published. These commands check explicitly supplied Stack and general Skills checkouts; they never reset a checkout or substitute a different general Skills revision.

```sh
pnpm --filter @kriscard/cli build
node packages/cli/dist/bin.js doctor --stack /path/to/Stack --skills /path/to/compatible-Skills
node packages/cli/dist/bin.js setup --stack /path/to/Stack --skills /path/to/compatible-Skills --mode plain-skills --host pi --retention-days 30 --dry-run
```

Setup presents the destination and changed setting names, then asks for confirmation in an interactive terminal. Noninteractive runs do not write. Settings go to the user's `.config/kriscard-stack/config.json`; unrelated keys survive, updates keep a private backup, and a changed file during confirmation stops the write. `--home` is useful for fixture homes.

`--stow-source` names an explicit Stow package root. Setup writes `.config/kriscard-stack/config.json` under that root instead of writing through an existing home symlink. It does not run Stow or overwrite the home link; the user applies their chosen Stow package separately.

Doctor is read-only. It checks the declared general Skills revision, modified skill files, missing catalogs, duplicate source names, required tools, and optional capabilities. It does not install Docker, simulators, hosts, or Tailscale. Tool detection is not proof of authentication or worker-launch readiness. Library callers can supply remote configuration observations, but those results are not a live audit of tailnet policy.

Remaining T6 work includes checking installed skill ownership through the CLI, the advisory setup skill, bootstrap-package tests, broader security/permission cases, and independent verification. This package does not provision credentials or modify host configuration or tailnet policy.
