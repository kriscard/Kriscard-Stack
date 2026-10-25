import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  ProviderDoc,
  ROOT_CONVERSATION_ID,
  type ConversationId,
  type ConversationRecord,
  type Cursor,
  type Harness,
  type Tx,
} from "@earendil-works/pi-durable";

import type { RoleProfile } from "./inputs.js";
import type { TaskFiles } from "./task-files.js";

export const TASK_SDK_VERSION = "1.4.0";

export type TaskMetadata = {
  formatVersion: 1;
  sdkVersion: typeof TASK_SDK_VERSION;
  taskId: string;
  directory: string;
  directoryDevice: string;
  directoryInode: string;
  lockDevice: string;
  lockInode: string;
  repositoryRoot: string;
  repositoryDevice: string;
  repositoryInode: string;
  createdAt: number;
};

export type ConversationIdentity = {
  conversationId: ConversationId | null;
  providerSessionId: string;
  role: RoleProfile["role"] | "unassigned";
  assignmentId: string | null;
};

export type ConversationBinding = Readonly<
  ConversationIdentity & { conversationId: ConversationId }
>;

export type TaskMetadataState = { record: TaskMetadata | null };

export const TaskMetadataDoc = defineDoc<TaskMetadataState>({
  kind: "kstack.task",
  version: 1,
  scope: "session",
  initial: () => ({ record: null }),
  checkpointWhen: () => true,
});

export const ConversationIdentityDoc = defineDoc<ConversationIdentity>({
  kind: "kstack.conversation-identity",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    conversationId: null,
    providerSessionId: "",
    role: "unassigned",
    assignmentId: null,
  }),
  checkpointWhen: () => true,
});

export function repositoryIdentity(path: string) {
  if (!isAbsolute(path)) throw new Error("Repository root must be absolute");

  const root = realpathSync(path);
  const info = statSync(root, { bigint: true });

  if (!info.isDirectory()) throw new Error("Repository root must remain an existing directory");

  return { root, device: info.dev.toString(), inode: info.ino.toString() };
}

export async function initializeConversationIdentity(tx: Tx, conversation: ConversationRecord) {
  const provider = await tx.doc(ProviderDoc, conversation.id);
  const identity = await tx.doc(ConversationIdentityDoc, conversation.id);
  identity.conversationId = conversation.id;
  identity.providerSessionId = provider.sessionId;
  identity.role = conversation.id === ROOT_CONVERSATION_ID ? "main" : "unassigned";
  identity.assignmentId = null;
}

export function validateTaskMetadata(
  state: Readonly<TaskMetadataState> | undefined,
  files: TaskFiles,
) {
  const value = state?.record;
  const directory = statSync(files.directory, { bigint: true });

  if (
    !value ||
    value.formatVersion !== 1 ||
    value.sdkVersion !== TASK_SDK_VERSION ||
    value.taskId !== files.taskId ||
    value.directory !== files.directory ||
    value.directoryDevice !== directory.dev.toString() ||
    value.directoryInode !== directory.ino.toString() ||
    value.lockDevice !== files.lockDevice ||
    value.lockInode !== files.lockInode ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt <= 0
  ) {
    throw new Error("Task metadata does not match its runtime, directory, or lock identity");
  }

  if (String(value.repositoryRoot) !== value.repositoryRoot || !isAbsolute(value.repositoryRoot)) {
    throw new Error("Recorded repository identity is invalid");
  }

  const repository = repositoryIdentity(value.repositoryRoot);

  if (
    repository.root !== value.repositoryRoot ||
    repository.device !== value.repositoryDevice ||
    repository.inode !== value.repositoryInode
  ) {
    throw new Error("Recorded repository identity changed; reconciliation is required");
  }

  return Object.freeze({ ...value });
}

export async function readConversationIdentities(harness: Harness, context: Context) {
  const identities: ConversationBinding[] = [];
  const sessions = new Set<string>();
  let cursor: Cursor | undefined;

  do {
    const page = await harness.commit((tx) => tx.scanConversations({}, 64, cursor), context);

    for (const conversation of page.items) {
      const identity = await harness.snapshot(ConversationIdentityDoc, conversation.id, context);
      const provider = await harness.snapshot(ProviderDoc, conversation.id, context);

      if (
        !identity ||
        !provider ||
        identity.conversationId !== conversation.id ||
        String(provider.sessionId) !== provider.sessionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          provider.sessionId,
        ) ||
        identity.providerSessionId !== provider.sessionId ||
        sessions.has(provider.sessionId) ||
        !["main", "writer", "reviewer", "verifier", "unassigned"].includes(identity.role) ||
        (identity.role === "main") !== (conversation.id === ROOT_CONVERSATION_ID)
      ) {
        throw new Error("Missing, conflicting, or invalid conversation/provider identity binding");
      }

      const assignment = identity.assignmentId;

      if (identity.role === "main" || identity.role === "unassigned") {
        if (assignment !== null)
          throw new Error("Unassigned/main identities cannot claim an assignment");
      } else if (!assignment || String(assignment) !== assignment || !assignment.trim()) {
        throw new Error("Worker identities require a valid assignment binding");
      }

      sessions.add(provider.sessionId);
      identities.push(Object.freeze({ ...identity, conversationId: conversation.id }));
    }

    cursor = page.next;
  } while (cursor !== undefined);

  return Object.freeze(identities);
}
