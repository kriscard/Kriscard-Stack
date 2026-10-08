# `@kriscard/control-plane`

The durable Kriscard Stack control-plane package. T3 introduces its private immutable artifact store; later tasks add live Pi Durable state and the versioned API.

## Artifact store

Approved revisions and final evidence are stored outside application repositories under:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/kriscard-stack/
```

Directories are mode `0700` and files are mode `0600`. Each immutable bundle contains readable artifacts plus `manifest.json` with repository/work-item context and SHA-256 hashes. Imports use durable journals and same-filesystem staging so interrupted migrations can resume without replacing an existing approved bundle.

The store rejects absolute paths, traversal, symbolic links, hash changes, untracked bundle files, and attempts to reuse one migration or destination for different content.
