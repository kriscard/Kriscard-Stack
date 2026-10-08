# `@kriscard/control-plane`

The durable Kriscard Stack control-plane package. Approved artifacts are immutable files; Pi Durable and SQLite own live command state. T5 adds one authenticated HTTP API for CLI, Pi, and Claude clients; worker adapters remain later tasks.

## Artifact store

```ts
import { createArtifactStore } from "@kriscard/control-plane/artifacts";

const store = createArtifactStore();
await store.initialize();
```

This Node-only package publishes standard ESM files and declarations through its package exports. A browser bundler would add a build step without changing the filesystem behavior or making the interface simpler.

Approved revisions and final evidence are stored outside application repositories under:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/kriscard-stack/
```

Directories are mode `0700` and files are mode `0600`. Each immutable bundle contains readable artifacts plus `manifest.json` with repository, target branch, starting commit, work item, task group, working branch, and explicit pull-request applicability. Evidence always names a pull request. Imports use fsynced journals, same-filesystem staging, and fsynced directory renames so interrupted migrations can resume without replacing an existing approved bundle.

Export is idempotent and resumes matching partial destinations while rejecting conflicting files. Restore rechecks approval and evidence relationships rather than trusting self-consistent hashes from an exported manifest. Restore is an explicit recovery copy and never deletes its backup. The store rejects sources inside the private store, absolute paths, traversal, reserved paths, symbolic links below canonical trust roots, hash changes, untracked bundle files, and attempts to reuse one migration or destination for different content.

Legacy source files are retired only through a separate, explicit resumable migration finalization step after the canonical destination verifies. Unrelated source-directory files are never removed.

## Recovering an interrupted import

Use the import's `migrationId` to call `store.resumeMigration(migrationId)`, then call `store.verify(reference)` to check the stored copy. If the old files should be removed, call `store.retireMigrationSource(migrationId)` separately. This only retires imported legacy files; `store.restore(backupDirectory)` copies a backup and always leaves it alone. Existing export destinations and store roots must already have private permissions (`0700`); the store will not change the permissions of an unrelated directory.

## Live runtime (T4)

`src/runtime/open.ts` opens one SQLite-backed Pi Durable Harness beneath the same private data root. A macOS `lockf` launch lock stays held until the Harness closes, so another process cannot open the authoritative state concurrently. SQLite files and sidecars must be regular `0600` files; the runtime sets a process-wide `077` umask for its lifetime. Run it in a dedicated Node process, not embedded in another application's process. Its callers use `submit`, `command`, and `close`; the mutable Harness remains inside the runtime module.

`src/runtime/commands.ts` reserves idempotency keys and records task checkpoints, bounded retries, leases, and receipts in Pi Durable. Only the core replay classes `idempotent_with_key` and `manual_recovery` are supported so far. Adapters classify operations before submission. Idempotent adapters must use the supplied key to reconcile duplicate effects, including an interrupted final attempt. Dispatch deadlines abort and fence hung adapters; an unknown outcome becomes `needs_reconciliation` rather than being automatically dispatched again. Adapters return short opaque receipt references (1–256 characters), never artifact bytes or secrets. Invalid references require reconciliation rather than replay. Adapter error text is not sent to clients; they receive a bounded stage-level failure instead. In-process adapters must honor cancellation to avoid lingering external activity, even though a late result cannot overwrite a settled receipt. These are runtime primitives, not a public worker-launch API; no coding worker is launched by T4.

## Client API (T5)

`@kriscard/control-plane/runtime` opens the single writer. `@kriscard/control-plane/api` serves its versioned state and commands over a loopback-only HTTP listener and offers a shared client. Supply per-device credentials from a host secret store or environment injection, not a checked-in file. Only an explicitly configured private Tailscale Serve endpoint should expose the loopback listener remotely; public binding is rejected.

```ts
import { openControlPlane } from "@kriscard/control-plane/runtime";
import {
  startApiServer,
  createControlPlaneClient,
} from "@kriscard/control-plane/api";

// The host supplies dataRoot, context, adapter, deviceId, secret, and uniqueKey.
const runtime = await openControlPlane(dataRoot, context, adapter);
const server = await startApiServer({
  runtime,
  deviceCredentials: { [deviceId]: secretFromHostCredentialStore },
});
const client = createControlPlaneClient({
  url: server.url,
  deviceId,
  credential: secretFromHostCredentialStore,
});
const { version } = await client.state();
await client.submit({
  key: uniqueKey,
  operation: "probe",
  expectedVersion: version,
});
// On shutdown: await server.close(); await runtime.close();
```

`/v1` and the `X-Kriscard-Api-Version: 1` header negotiate the protocol. A duplicate key returns its existing task; a stale version is `409`. The ordered SSE stream accepts the last acknowledged position, including after reconnect or restart. It retains the latest 2,048 events; `410 EXPIRED_POSITION` means fetch `/v1/state` and reconnect from its version. Authenticated artifact responses stream through an application-provided opaque-ID resolver instead of embedding large bytes in events. The resolver must map IDs to approved private artifacts and never accept filesystem paths from clients.
