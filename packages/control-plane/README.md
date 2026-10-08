# `@kriscard/control-plane`

The durable Kriscard Stack control-plane package. T3 introduces its private immutable artifact store; later tasks add live Pi Durable state and the versioned API.

## Artifact store

Approved revisions and final evidence are stored outside application repositories under:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/kriscard-stack/
```

Directories are mode `0700` and files are mode `0600`. Each immutable bundle contains readable artifacts plus `manifest.json` with repository, target branch, starting commit, work item, task group, working branch, and explicit pull-request applicability. Evidence always names a pull request. Imports use fsynced journals, same-filesystem staging, and fsynced directory renames so interrupted migrations can resume without replacing an existing approved bundle.

Export is idempotent and resumes matching partial destinations while rejecting conflicting files. Restore rechecks approval and evidence relationships rather than trusting self-consistent hashes from an exported manifest. Restore is an explicit recovery copy and never deletes its backup. The store rejects sources inside the private store, absolute paths, traversal, reserved paths, symbolic links below canonical trust roots, hash changes, untracked bundle files, and attempts to reuse one migration or destination for different content.

Legacy source files are retired only through a separate, explicit resumable migration finalization step after the canonical destination verifies. Unrelated source-directory files are never removed.

## Recovering an interrupted import

Use the import's `migrationId` to call `store.resumeMigration(migrationId)`, then call `store.verify(reference)` to check the stored copy. If the old files should be removed, call `store.retireMigrationSource(migrationId)` separately. This only retires imported legacy files; `store.restore(backupDirectory)` copies a backup and always leaves it alone. Existing export destinations and store roots must already have private permissions (`0700`); the store will not change the permissions of an unrelated directory.
