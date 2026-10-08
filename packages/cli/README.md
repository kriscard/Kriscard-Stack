# `@kriscard/cli`

Read-only diagnostics and confirmed setup settings for Kriscard Stack. The first release supports macOS and Node 24 or newer. The package is not yet published.

## Development use

From a Stack checkout:

```sh
pnpm --filter @kriscard/cli build
node packages/cli/dist/bin.js doctor --stack /chosen/Stack --skills /chosen/compatible-Skills --installed-skills /chosen/host-skills
node packages/cli/dist/bin.js setup --stack /chosen/Stack --skills /chosen/compatible-Skills --installed-skills /chosen/host-skills --mode plain-skills --host pi --retention-days 30 --dry-run
```

Choose existing checkout paths and read `config/skills-source.json` for the required general Skills revision. Repeat `--installed-skills` for every shared or host-specific directory the selected host reads. Omitted or empty roots block setup. At least one matching installed skill from each source must be present; this does not require installing every skill in either collection. Identical installations shared by Pi and Claude are allowed; an installed name with different bundle content blocks setup. Comparison includes relative file names and bytes throughout the skill directory, including references, scripts, and assets. Generated `node_modules`, Git metadata, and `.DS_Store` are excluded. Broken links, escaping bundle links, directory cycles, and non-regular bundle files fail inspection. Skills themselves are installed separately with the Skills CLI from the verified sources; this CLI checks both sources instead of guessing or cloning a different revision.

After reviewing the preview, run the same setup command without `--dry-run` in an interactive terminal. Setup shows the destination and setting values, then asks before writing. Noninteractive runs do not write.

## Local bootstrap package

Build before packing. Use an external directory so the archive does not enter the application repository:

```sh
archive_dir="$(mktemp -d)"
npm pack ./packages/cli --ignore-scripts --pack-destination "$archive_dir"
npx --yes --package "$archive_dir/kriscard-cli-0.0.0.tgz" kriscard-stack --help
pnpm dlx "$archive_dir/kriscard-cli-0.0.0.tgz" --help
```

Both launchers accept the same `doctor` and `setup` arguments above. The tests exercise both launchers against a local tarball with package downloads disabled. Public npm bootstrap instructions remain deferred until release.

## Configuration safety

Settings go to the user's `.config/kriscard-stack/config.json`. `--home` selects an alternate home. Unrelated JSON keys survive; updates keep a private exact backup and use an atomic replacement. Changed files during confirmation, unknown schema versions, hard-linked files, occupied locks, and unexpected directory symlinks stop the write. Existing Stack config directories must be private (`0700`); setup reports the issue rather than loosening permissions. Files and backups are created as `0600`.

`--stow-source` names an explicit Stow package root. Setup writes `.config/kriscard-stack/config.json` under it instead of writing through a home symlink. It does not run Stow or rewrite home links. Apply your chosen Stow package separately after accepting the source change.

An occupied `.setup-lock` can indicate another setup or an interrupted write. Check that no setup process is running, inspect the destination and backup, and obtain permission before removing a stale lock. No automatic lock deletion is performed.

## What doctor proves

Doctor checks the declared general Skills revision, modified skill files, missing catalogs, duplicate source names, conflicting installed content, required tools, and optional capabilities. It also reads saved settings under the selected home or explicit Stow source and reports malformed or unsupported configuration. Both saved source paths must be absolute, available directories and resolve to the supplied verified checkouts; stale or missing paths require setup to be rerun with the intended sources. Saved security-approval booleans are not accepted as independent policy evidence. `--json` returns the diagnostic results without command output or secrets. Tool detection is not proof of authentication, simulator readiness, or worker-launch ability.

Missing Docker, simulator tools, Herdr, or Tailscale produce warnings. Nothing is installed automatically. Remote access not inspected is explicitly reported as a warning. Library callers may supply remote configuration observations, but that is not a live audit of tailnet policy. Setup refuses remote-enabled existing settings until a separate security review; it never enables Serve or Funnel, approves devices, changes grants, or stores credentials.

Runtime selection records a preference only. Host adapters, worker launch, live tailnet diagnostics, and publication are later tasks. Plain-skills mode needs no durable daemon and does not claim crash-safe execution. The companion [setup skill](../../skills/dev/setup-kriscard-stack/SKILL.md) guides the interview and confirmation.
