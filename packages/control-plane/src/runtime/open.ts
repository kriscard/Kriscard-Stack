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
import { createArtifactStore } from "../artifacts/index.js";
import {
  Commands,
  createCommandTask,
  reserveCommand,
  submitCommand,
  type CommandAdapter,
  type CommandEvent,
  type CommandLedger,
  type CommandRecord,
  type CommandRequest,
} from "./commands.js";
import { acquireOwnerLock } from "./ownership.js";
import {
  PlanningRuns,
  createPlanningFinalizeTask,
  recoverInterruptedPlanningReviews,
  submitPlanningCommand,
  type PlanningCommandRequest,
  type PlanningEvent,
  type PlanningLedger,
  type PlanningRun,
} from "./planning.js";

let activeRuntime = false;
// Retain the lock descriptor if a failed SQLite close leaves writer state uncertain.
const uncertainOwners: Array<Awaited<ReturnType<typeof acquireOwnerLock>>> = [];

export interface OpenControlPlane {
  submit(input: CommandRequest): Promise<number>;
  submitVersioned(
    input: CommandRequest,
    expectedVersion: number,
  ): Promise<{ taskId: number; version: number }>;
  command(key: string): Promise<Readonly<CommandRecord> | undefined>;
  state(): Promise<{
    version: number;
    commands: Record<string, CommandRecord>;
  }>;
  eventsAfter(
    position: number,
  ): Promise<{ version: number; events: CommandEvent[] }>;
  submitPlanning(
    input: PlanningCommandRequest,
  ): Promise<{ version: number; taskId?: number }>;
  planningRun(revisionId: string): Promise<Readonly<PlanningRun> | undefined>;
  planningState(): Promise<{
    version: number;
    runs: Record<string, PlanningRun>;
  }>;
  planningEventsAfter(
    position: number,
  ): Promise<{ version: number; events: PlanningEvent[] }>;
  close(): Promise<void>;
}

export class ExpiredEventPositionError extends Error {}

export async function openControlPlane(
  dataRoot: string = defaultArtifactRoot(),
  context: Context = BACKGROUND_CONTEXT,
  commandAdapter?: CommandAdapter,
  options: { artifactStore?: ReturnType<typeof createArtifactStore> } = {},
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
    const planningTask = createPlanningFinalizeTask(
      options.artifactStore ?? createArtifactStore({ root }),
    );
    registry.install({ name: "kriscard.planning", tasks: [planningTask] });
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
    }
    await recoverInterruptedPlanningReviews(openedHarness, context);
    openedHarness.resume();
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
      async submitVersioned(input, expectedVersion) {
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
          throw new RangeError(
            "Expected version must be a nonnegative integer",
          );
        if (!commandTask || !commandAdapter)
          throw new Error("No command adapter is configured");
        const replayClass = commandAdapter.classify(input.operation);
        if (!replayClass)
          throw new Error(`Unsupported command operation: ${input.operation}`);
        return reserveCommand(
          openedHarness,
          commandTask,
          { ...input, replayClass },
          expectedVersion,
        );
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
      async state() {
        const ledger = await openedHarness.snapshot(
          Commands,
          BACKGROUND_CONTEXT,
        );
        return {
          version: ledger?.version ?? 0,
          commands: structuredClone(ledger?.commands ?? {}),
        };
      },
      async eventsAfter(position) {
        const ledger: CommandLedger | undefined = await openedHarness.snapshot(
          Commands,
          BACKGROUND_CONTEXT,
        );
        return eventsAfter(
          position,
          ledger?.version ?? 0,
          ledger?.events ?? [],
        );
      },
      async submitPlanning(input) {
        return submitPlanningCommand(
          openedHarness,
          planningTask,
          input,
          context,
        );
      },
      async planningRun(revisionId) {
        const ledger = await openedHarness.snapshot(
          PlanningRuns,
          BACKGROUND_CONTEXT,
        );
        const run = ledger?.runs[revisionId];
        return run ? structuredClone(run) : undefined;
      },
      async planningState() {
        const ledger = await openedHarness.snapshot(
          PlanningRuns,
          BACKGROUND_CONTEXT,
        );
        return {
          version: ledger?.version ?? 0,
          runs: structuredClone(ledger?.runs ?? {}),
        };
      },
      async planningEventsAfter(position) {
        const ledger: PlanningLedger | undefined = await openedHarness.snapshot(
          PlanningRuns,
          BACKGROUND_CONTEXT,
        );
        return eventsAfter(
          position,
          ledger?.version ?? 0,
          ledger?.events ?? [],
        );
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

function eventsAfter<Event extends { position: number }>(
  position: number,
  version: number,
  events: readonly Event[],
): { version: number; events: Event[] } {
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RangeError("Event position must be a nonnegative integer");
  if (position > version)
    throw new RangeError("Event position exceeds the current version");
  if (events.length > 0 && position < events[0]!.position - 1)
    throw new ExpiredEventPositionError(
      `Event position ${position} has expired (oldest ${events[0]!.position}, version ${version}); fetch a fresh state snapshot`,
    );
  return {
    version,
    events: structuredClone(
      events.filter((event) => event.position > position),
    ),
  };
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
