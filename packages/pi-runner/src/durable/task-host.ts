import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";

import type { Context } from "@earendil-works/chord";
import { awaitWithContext, withoutAbortSignal } from "@earendil-works/chord/context";
import { PI_AI_VERSION, type Models } from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  ROOT_CONVERSATION_ID,
  type Extension,
  type Storage,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { acquireTaskFiles, checkSqliteFiles, type TaskFiles } from "./task-files.js";
import { WritableWorkspaces } from "./workspaces.js";
import {
  initializeConversationIdentity,
  readConversationIdentities,
  repositoryIdentity,
  TASK_SDK_VERSION,
  TaskMetadataDoc,
  validateTaskMetadata,
  type TaskMetadata,
} from "./task-state.js";

export type TaskHostOptions = {
  stateDir?: string;
  models: Models;
  extensions?: readonly Extension[];
};

function checkRuntime(context: Context) {
  context.abortSignal?.throwIfAborted();

  if (PI_AI_VERSION !== TASK_SDK_VERSION) throw new Error("Unsupported SDK runtime version");
}

export class DurableTaskHost {
  private closing: Promise<void> | undefined;
  readonly workspaces = new WritableWorkspaces(this);

  private constructor(
    private readonly files: TaskFiles,
    readonly harness: Harness,
  ) {}

  get taskId() {
    return this.files.taskId;
  }

  get directory() {
    return this.files.directory;
  }

  static async start(options: TaskHostOptions & { repositoryRoot: string }, context: Context) {
    checkRuntime(context);
    const repository = repositoryIdentity(options.repositoryRoot);
    const files = await acquireTaskFiles(randomUUID(), options.stateDir, "start", context);

    return DurableTaskHost.open(files, options, repository, context);
  }

  static async reopen(options: TaskHostOptions & { taskId: string }, context: Context) {
    checkRuntime(context);
    const files = await acquireTaskFiles(options.taskId, options.stateDir, "resume", context);

    return DurableTaskHost.open(files, options, undefined, context);
  }

  private static async open(
    files: TaskFiles,
    options: TaskHostOptions,
    repository: ReturnType<typeof repositoryIdentity> | undefined,
    context: Context,
  ) {
    let storage: Storage | undefined;
    let harness: Harness | undefined;
    let host: DurableTaskHost | undefined;

    try {
      const registry = createRegistry();

      for (const extension of options.extensions ?? []) registry.install(extension);

      storage = await openNodeSqliteStorage(files.database);
      harness = await Harness.open(
        storage,
        {
          models: options.models,
          registry,
          conversationCreated: initializeConversationIdentity,
        },
        context,
      );

      if (repository) {
        const directory = statSync(files.directory, { bigint: true });
        await harness.root(context, {
          init: async (tx) => {
            const metadata = await tx.doc(TaskMetadataDoc);
            metadata.record = {
              formatVersion: 1,
              sdkVersion: TASK_SDK_VERSION,
              taskId: files.taskId,
              directory: files.directory,
              directoryDevice: directory.dev.toString(),
              directoryInode: directory.ino.toString(),
              lockDevice: files.lockDevice,
              lockInode: files.lockInode,
              repositoryRoot: repository.root,
              repositoryDevice: repository.device,
              repositoryInode: repository.inode,
              createdAt: Date.now(),
            } satisfies TaskMetadata;
          },
        });
      }

      if (!(await harness.conversation(ROOT_CONVERSATION_ID, context))) {
        throw new Error("Task root conversation is missing; no replacement will be created");
      }

      checkSqliteFiles(files.directory, true);
      validateTaskMetadata(await harness.snapshot(TaskMetadataDoc, context), files);
      await readConversationIdentities(harness, context);

      host = new DurableTaskHost(files, harness);
      await host.workspaces.reopen(context);

      return host;
    } catch (error) {
      const cleanup = withoutAbortSignal(context);

      try {
        if (harness) {
          try {
            await harness.close(cleanup);
          } finally {
            await harness.closed;
          }
        } else if (storage) {
          await storage.close(cleanup);
        }
      } finally {
        host?.workspaces.releaseKernelClaims();
        files.release();
      }

      throw error;
    }
  }

  async inspect(context: Context) {
    const metadata = validateTaskMetadata(
      await this.harness.snapshot(TaskMetadataDoc, context),
      this.files,
    );

    const identities = await readConversationIdentities(this.harness, context);

    return { metadata, identities, inspection: await this.harness.inspect(context) };
  }

  close(context: Context) {
    this.closing ??= this.finishClose(withoutAbortSignal(context));

    return awaitWithContext(this.closing, context);
  }

  private async finishClose(context: Context) {
    // Failed drain retains the live store, task lock and workspace claims.
    await this.workspaces.drain();

    try {
      await this.harness.close(context);
    } finally {
      // Only the wait is cancellable; ownership ends after the actual store/runtime close.
      await this.harness.closed;
      this.workspaces.releaseKernelClaims();
      this.files.release();
    }
  }
}
