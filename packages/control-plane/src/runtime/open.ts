import { lstat } from "node:fs/promises";
import path from "node:path";

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  type Harness as DurableHarness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import {
  canonicalizePotentialPath,
  defaultArtifactRoot,
} from "../artifacts/paths.js";
import {
  Commands,
  createCommandTask,
  submitCommand,
  type CommandAdapter,
  type CommandRecord,
  type CommandRequest,
} from "./commands.js";
import { acquireOwnerLock } from "./ownership.js";

let activeRuntime = false;
// Retain the lock descriptor if a failed SQLite close leaves writer state uncertain.
const uncertainOwners: Array<Awaited<ReturnType<typeof acquireOwnerLock>>> = [];

export interface OpenControlPlane {
  submit(input: CommandRequest): Promise<number>;
  command(key: string): Promise<Readonly<CommandRecord> | undefined>;
  close(): Promise<void>;
}

export async function openControlPlane(
  dataRoot: string = defaultArtifactRoot(),
  context: Context = BACKGROUND_CONTEXT,
  commandAdapter?: CommandAdapter,
): Promise<OpenControlPlane> {
  const root = canonicalizePotentialPath(dataRoot);
  if (activeRuntime) {
    throw Object.assign(
      new Error("A control plane is already open in this process"),
      {
        code: "ALREADY_RUNNING",
      },
    );
  }
  activeRuntime = true;
  let owner: Awaited<ReturnType<typeof acquireOwnerLock>>;
  try {
    owner = await acquireOwnerLock(root);
  } catch (error) {
    activeRuntime = false;
    throw error;
  }
  const previousUmask = process.umask(0o077);
  const databasePath = path.join(root, "state.sqlite");
  let storage: Awaited<ReturnType<typeof openNodeSqliteStorage>> | undefined;
  let harness: DurableHarness | undefined;

  try {
    await assertPrivateDatabaseFiles(databasePath);
    storage = await openNodeSqliteStorage(databasePath);
    const registry = createRegistry();
    const commandTask = commandAdapter
      ? createCommandTask(commandAdapter)
      : undefined;
    if (commandTask) {
      registry.install({ name: "kriscard.commands", tasks: [commandTask] });
    }
    const openedHarness = await Harness.open(
      storage,
      { models: createModels(), registry },
      context,
    );
    harness = openedHarness;
    await assertPrivateDatabaseFiles(databasePath);
    if (commandAdapter) {
      const ledger = await openedHarness.snapshot(Commands, context);
      for (const record of Object.values(ledger?.commands ?? {})) {
        if (
          (record.status === "queued" || record.status === "running") &&
          commandAdapter.classify(record.operation) !== record.replayClass
        ) {
          throw new Error(
            `Adapter replay policy changed for ${record.operation}`,
          );
        }
      }
      openedHarness.resume();
    }
    let closed = false;

    return {
      async submit(input): Promise<number> {
        if (!commandTask || !commandAdapter)
          throw new Error("No command adapter is configured");
        const replayClass = commandAdapter.classify(input.operation);
        if (!replayClass)
          throw new Error(`Unsupported command operation: ${input.operation}`);
        return submitCommand(openedHarness, commandTask, {
          ...input,
          replayClass,
        });
      },
      async command(key): Promise<Readonly<CommandRecord> | undefined> {
        const ledger = await openedHarness.snapshot(
          Commands,
          BACKGROUND_CONTEXT,
        );
        const record =
          ledger && Object.hasOwn(ledger.commands, key)
            ? ledger.commands[key]
            : undefined;
        return record ? structuredClone(record) : undefined;
      },
      async close(): Promise<void> {
        if (closed) return;
        try {
          await openedHarness.close(BACKGROUND_CONTEXT);
        } catch (error) {
          uncertainOwners.push(owner);
          throw error;
        }
        await owner.release();
        process.umask(previousUmask);
        closed = true;
        activeRuntime = false;
      },
    };
  } catch (error) {
    try {
      if (harness) await harness.close(BACKGROUND_CONTEXT);
      else await storage?.close(BACKGROUND_CONTEXT);
    } catch (closeError) {
      // Keep the lock rather than admit another writer while storage may be open.
      uncertainOwners.push(owner);
      throw new AggregateError(
        [error, closeError],
        "Could not close SQLite state",
      );
    }
    await owner.release();
    process.umask(previousUmask);
    activeRuntime = false;
    throw error;
  }
}

async function assertPrivateDatabaseFiles(databasePath: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = `${databasePath}${suffix}`;
    let info;
    try {
      info = await lstat(filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o777) !== 0o600
    ) {
      throw new Error(
        `SQLite state must be a private regular file: ${filePath}`,
      );
    }
  }
}
