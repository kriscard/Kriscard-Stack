import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineTask,
  type Harness,
  type TaskRuntime,
} from "@earendil-works/pi-durable";
import type { ReplayClass } from "@kriscard/core";

/** Other core replay classes need their own dispatch/reconciliation adapters. */
export type CommandReplayClass = Extract<
  ReplayClass,
  "idempotent_with_key" | "manual_recovery"
>;
export type CommandRequest = {
  key: string;
  operation: string;
};
export type CommandInput = CommandRequest & { replayClass: CommandReplayClass };
export type CommandReceipt = {
  reference: string;
  completedAt: number;
};
export type CommandRecord = CommandInput & {
  taskId: number;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "needs_reconciliation";
  attempts: number;
  leaseExpiresAt?: number;
  receipt?: CommandReceipt;
  error?: string;
};
export type CommandEvent = { position: number; command: CommandRecord };
export type CommandLedger = {
  commands: Record<string, CommandRecord>;
  // Optional to read T4 databases without rewriting their authoritative state.
  version?: number;
  events?: CommandEvent[];
};

const EVENT_LIMIT = 2_048;

export class StaleCommandVersionError extends Error {}

function appendCommandEvent(
  ledger: CommandLedger,
  command: CommandRecord,
): number {
  const position = (ledger.version ?? 0) + 1;
  ledger.version = position;
  ledger.events = [
    ...(ledger.events ?? []),
    {
      position,
      command: {
        ...command,
        ...(command.receipt ? { receipt: { ...command.receipt } } : {}),
      },
    },
  ].slice(-EVENT_LIMIT);
  return position;
}

export const Commands = defineDoc<CommandLedger>({
  kind: "kriscard.commands",
  version: 1,
  scope: "session",
  initial: () => ({ commands: {} }),
});

type CommandPhase =
  | { phase: "claim" }
  | { phase: "execute_idempotent"; attempt: number; inFlight: boolean }
  | { phase: "retry_idempotent"; attempt: number }
  | { phase: "unsafe_interrupted" };

/** External adapters must honor the key for idempotent replay; unsafe actions never auto-replay. */
export interface CommandAdapter {
  classify(operation: string): CommandReplayClass | undefined;
  /** Maximum time one dispatch may hold its lease; defaults to one minute. */
  leaseDurationMs?: number;
  /** Return a short opaque receipt reference (at most 256 characters), never artifact bytes or a secret. */
  execute(input: CommandInput, signal: AbortSignal): Promise<string>;
}

class CommandDeadlineError extends Error {}
class InvalidReceiptReferenceError extends Error {}

function describeCommandFailure(error: unknown): string {
  if (
    error instanceof CommandDeadlineError ||
    error instanceof InvalidReceiptReferenceError
  )
    return error.message;
  return "Command adapter failed; external outcome may be unknown";
}

export function createCommandTask(adapter: CommandAdapter) {
  const leaseDurationMs = adapter.leaseDurationMs ?? 60_000;
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1 ||
    leaseDurationMs > 2_147_483_647
  ) {
    throw new Error("Command lease duration must be a positive integer");
  }
  return defineTask<CommandInput, CommandPhase, CommandReceipt>({
    name: "kriscard.command",
    version: 1,
    initial: () => ({ phase: "claim" }),
    phases: {
      claim: async (task, runtime, context) => {
        let deadline = 0;
        await runtime.commit(async (tx) => {
          const ledger = await tx.doc(Commands);
          const record = ledger.commands[task.input.key];
          if (
            !record ||
            record.taskId !== runtime.taskId ||
            record.status !== "queued"
          ) {
            throw new Error(
              "Command claim does not match its durable reservation",
            );
          }
          record.status = "running";
          if (task.input.replayClass === "manual_recovery") {
            record.attempts = 1;
            deadline = runtime.now() + leaseDurationMs;
            record.leaseExpiresAt = deadline;
          }
          appendCommandEvent(ledger, record);
          return {
            status: "running",
            checkpoint:
              task.input.replayClass === "idempotent_with_key"
                ? { phase: "execute_idempotent", attempt: 0, inFlight: false }
                : { phase: "unsafe_interrupted" },
          };
        }, context);

        if (task.input.replayClass === "manual_recovery") {
          await executeOnce(task.input, runtime, context, adapter, deadline);
        }
      },
      execute_idempotent: async (task, runtime, context) => {
        let exhausted = false;
        let deadline = 0;
        await runtime.commit(async (tx) => {
          const ledger = await tx.doc(Commands);
          const record = ledger.commands[task.input.key];
          if (
            !record ||
            record.status !== "running" ||
            record.attempts !== task.state.checkpoint.attempt
          ) {
            throw new Error(
              "Command checkpoint does not match its durable attempt",
            );
          }
          if (!task.state.checkpoint.inFlight && record.attempts >= 3) {
            exhausted = true;
            record.status = "failed";
            record.error = "Replay-safe command exhausted its retry budget";
            delete record.leaseExpiresAt;
            appendCommandEvent(ledger, record);
            return {
              status: "terminal",
              outcome: { status: "failed", error: { message: record.error } },
            };
          }
          // Reconcile an interrupted in-flight attempt with the same key, even at the retry limit.
          if (!task.state.checkpoint.inFlight) record.attempts++;
          deadline = runtime.now() + leaseDurationMs;
          record.leaseExpiresAt = deadline;
          appendCommandEvent(ledger, record);
          return {
            status: "running",
            checkpoint: {
              phase: "execute_idempotent",
              attempt: record.attempts,
              inFlight: true,
            },
          };
        }, context);
        if (exhausted) return;
        try {
          const reference = await executeWithDeadline(
            task.input,
            adapter,
            runtime,
            deadline,
          );
          await completeCommand(task.input.key, reference, runtime, context);
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await runtime.commit(async (tx) => {
            const ledger = await tx.doc(Commands);
            const record = ledger.commands[task.input.key];
            if (!record) throw new Error("Missing command reservation");
            record.error = describeCommandFailure(error);
            if (
              error instanceof CommandDeadlineError ||
              error instanceof InvalidReceiptReferenceError
            ) {
              record.status = "needs_reconciliation";
              delete record.leaseExpiresAt;
              appendCommandEvent(ledger, record);
              return {
                status: "terminal",
                outcome: { status: "failed", error: { message: record.error } },
              };
            }
            if (record.attempts >= 3) {
              record.status = "needs_reconciliation";
              record.error = `Retry budget exhausted; external outcome may be unknown: ${record.error}`;
              delete record.leaseExpiresAt;
              appendCommandEvent(ledger, record);
              return {
                status: "terminal",
                outcome: { status: "failed", error: { message: record.error } },
              };
            }
            appendCommandEvent(ledger, record);
            return {
              status: "running",
              checkpoint: {
                phase: "retry_idempotent",
                attempt: record.attempts,
              },
            };
          }, context);
        }
      },
      retry_idempotent: async (task, runtime, context) => {
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: {
              phase: "execute_idempotent",
              attempt: task.state.checkpoint.attempt,
              inFlight: false,
            },
          }),
          context,
        );
      },
      unsafe_interrupted: async (task, runtime, context) => {
        await runtime.commit(async (tx) => {
          const ledger = await tx.doc(Commands);
          const record = ledger.commands[task.input.key];
          if (!record || record.status !== "running")
            throw new Error("Missing unsafe intent");
          record.status = "needs_reconciliation";
          record.error =
            "Execution was interrupted after durable intent; external outcome is unknown";
          delete record.leaseExpiresAt;
          appendCommandEvent(ledger, record);
          return {
            status: "terminal",
            outcome: { status: "failed", error: { message: record.error } },
          };
        }, context);
      },
    },
    abort: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        const ledger = await tx.doc(Commands);
        const record = ledger.commands[task.input.key];
        if (record && record.status !== "completed") {
          record.status = "needs_reconciliation";
          record.error =
            "Command aborted; inspect external state before retrying";
          delete record.leaseExpiresAt;
          appendCommandEvent(ledger, record);
        }
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context);
    },
  });
}

async function executeOnce(
  input: CommandInput,
  runtime: TaskRuntime<CommandInput, CommandPhase, CommandReceipt, object>,
  context: Context,
  adapter: CommandAdapter,
  deadline: number,
): Promise<void> {
  try {
    const reference = await executeWithDeadline(
      input,
      adapter,
      runtime,
      deadline,
    );
    await completeCommand(input.key, reference, runtime, context);
  } catch (error) {
    if (runtime.signal.aborted) throw error;
    await runtime.commit(async (tx) => {
      const ledger = await tx.doc(Commands);
      const record = ledger.commands[input.key];
      if (!record) throw new Error("Missing unsafe intent");
      record.status = "needs_reconciliation";
      record.error = `External outcome unknown: ${describeCommandFailure(error)}`;
      delete record.leaseExpiresAt;
      appendCommandEvent(ledger, record);
      return {
        status: "terminal",
        outcome: { status: "failed", error: { message: record.error } },
      };
    }, context);
  }
}

async function executeWithDeadline(
  input: CommandInput,
  adapter: CommandAdapter,
  runtime: TaskRuntime<CommandInput, CommandPhase, CommandReceipt, object>,
  deadline: number,
): Promise<string> {
  const controller = new AbortController();
  const signal = AbortSignal.any([runtime.signal, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(
          new CommandDeadlineError(
            "Command lease expired; external outcome is unknown",
          ),
        );
        controller.abort();
      },
      Math.max(0, deadline - runtime.now()),
    );
  });
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Command invocation was cancelled"));
    if (runtime.signal.aborted) onAbort();
    else runtime.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      adapter.execute(input, signal),
      expired,
      cancelled,
    ]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CommandDeadlineError(
        "Command lease expired; external outcome is unknown",
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) runtime.signal.removeEventListener("abort", onAbort);
  }
}

async function completeCommand(
  key: string,
  reference: string,
  runtime: TaskRuntime<CommandInput, CommandPhase, CommandReceipt, object>,
  context: Context,
): Promise<void> {
  if (
    typeof reference !== "string" ||
    reference.length < 1 ||
    reference.length > 256
  )
    throw new InvalidReceiptReferenceError(
      "Adapter returned an invalid receipt reference; inspect the external outcome",
    );
  await runtime.commit(async (tx) => {
    const ledger = await tx.doc(Commands);
    const record = ledger.commands[key];
    if (!record || record.status !== "running")
      throw new Error("Missing active command");
    const receipt = { reference, completedAt: runtime.now() };
    record.status = "completed";
    record.receipt = receipt;
    delete record.leaseExpiresAt;
    delete record.error;
    appendCommandEvent(ledger, record);
    return {
      status: "terminal",
      outcome: { status: "completed", result: receipt },
    };
  }, context);
}

/** Reserve the idempotency key and create its durable task in the same transaction. */
export async function submitCommand(
  harness: Harness,
  task: ReturnType<typeof createCommandTask>,
  input: CommandInput,
  context: Context = BACKGROUND_CONTEXT,
): Promise<number> {
  return (await reserveCommand(harness, task, input, undefined, context))
    .taskId;
}

export async function reserveCommand(
  harness: Harness,
  task: ReturnType<typeof createCommandTask>,
  input: CommandInput,
  expectedVersion: number | undefined,
  context: Context = BACKGROUND_CONTEXT,
): Promise<{ taskId: number; version: number }> {
  if (!input.key || !input.operation)
    throw new Error("A command needs a key and operation");
  if (
    input.replayClass !== "idempotent_with_key" &&
    input.replayClass !== "manual_recovery"
  ) {
    throw new Error("Unsupported command replay class");
  }
  const root = await harness.root(context);
  const reservation = await root.commit(async (tx) => {
    const ledger = await tx.doc(Commands);
    const existing = Object.hasOwn(ledger.commands, input.key)
      ? ledger.commands[input.key]
      : undefined;
    if (existing) {
      if (
        existing.operation !== input.operation ||
        existing.replayClass !== input.replayClass
      ) {
        throw new Error("Idempotency key already belongs to another command");
      }
      return { taskId: existing.taskId, version: ledger.version ?? 0 };
    }
    if (input.key.length > 256 || input.operation.length > 256)
      throw new Error(
        "Command key and operation must be at most 256 characters",
      );
    if (
      expectedVersion !== undefined &&
      expectedVersion !== (ledger.version ?? 0)
    ) {
      throw new StaleCommandVersionError("Command state version changed");
    }
    const taskId = await tx.createTask(task, input, {
      ownership: { kind: "conversation" },
    });
    const record: CommandRecord = {
      ...input,
      taskId,
      status: "queued",
      attempts: 0,
    };
    ledger.commands[input.key] = record;
    const version = appendCommandEvent(ledger, record);
    return { taskId, version };
  }, context);
  harness.resume();
  return reservation;
}
