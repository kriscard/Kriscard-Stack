import { createHash } from "node:crypto";

import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  ProviderDoc,
  ROOT_CONVERSATION_ID,
  type ConversationId,
  type ConversationOwnership,
  type ConversationRecord,
  type Cursor,
  type Tx,
} from "@earendil-works/pi-durable";

import { createRoleProfile, type RoleProfile, type RoleProfileInput } from "./inputs.js";
import type { DurableTaskHost } from "./task-host.js";
import { ConversationIdentityDoc, TaskMetadataDoc } from "./task-state.js";
import { WorkspacesDoc } from "./workspace-state.js";

export type AdmissionInputs = {
  profile: RoleProfile;
  contextFingerprint: string;
  sourceFingerprint: string;
  admittedAt: number;
  deadline: number;
};

export type AdmissionRecord = Omit<AdmissionInputs, "profile"> & {
  profile: Omit<RoleProfileInput, "writePaths" | "checkIds"> & {
    writePaths: string[];
    checkIds: string[];
  };
  taskId: string;
  taskDirectory: string;
  conversationId: ConversationId;
  providerSessionId: string;
  assignmentId: string | null;
  profileFingerprint: string;
  authority: string;
  configuration: { profileFingerprint: string; environmentFingerprint: string } | null;
  pendingEffectIds: string[];
};

export type ValidatedAdmission = Omit<AdmissionRecord, "profile"> & { profile: RoleProfile };

export const AdmissionDoc = defineDoc<{ record: AdmissionRecord | null }>({
  kind: "kstack.admission",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ record: null }),
  checkpointWhen: () => true,
});

function requireFingerprint(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Admission requires SHA-256 fingerprints");
}

function normalizeInputs(
  input: Omit<AdmissionInputs, "profile"> & { profile: RoleProfileInput },
): AdmissionInputs {
  const profile = createRoleProfile(input.profile);
  requireFingerprint(input.contextFingerprint);
  requireFingerprint(input.sourceFingerprint);

  if (
    !Number.isSafeInteger(input.admittedAt) ||
    input.admittedAt <= 0 ||
    !Number.isSafeInteger(input.deadline) ||
    input.deadline <= input.admittedAt
  )
    throw new Error("Admission requires original admission time and absolute deadline");

  return { ...input, profile };
}

export function admissionProfileFingerprint(profile: RoleProfileInput) {
  return createHash("sha256")
    .update(JSON.stringify(createRoleProfile(profile)))
    .digest("hex");
}

// Host-only: never register admission mutations as model-callable tools. The host must
// already hold its task lock and live workspace claims; these records do not acquire them.
async function admissionConversations(tx: Tx) {
  const conversations: ConversationRecord[] = [];
  let cursor: Cursor | undefined;

  do {
    const page = await tx.scanConversations({}, 64, cursor);
    conversations.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);

  return conversations;
}

async function ownedIdentity(
  tx: Tx,
  taskId: string,
  conversationId: ConversationId,
  knownConversations?: readonly ConversationRecord[],
) {
  const conversations = knownConversations ?? (await admissionConversations(tx));
  const metadata = (await tx.doc(TaskMetadataDoc)).record;
  const conversation = conversations.find((entry) => entry.id === conversationId);

  if (!metadata || metadata.taskId !== taskId || !conversation)
    throw new Error("Unknown admission task/conversation");
  const identity = await tx.doc(ConversationIdentityDoc, conversationId);
  const provider = await tx.doc(ProviderDoc, conversationId);

  if (
    identity.conversationId !== conversationId ||
    identity.providerSessionId !== provider.sessionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      provider.sessionId,
    ) ||
    !["main", "writer", "reviewer", "verifier"].includes(identity.role) ||
    (identity.role === "main") !== (conversationId === ROOT_CONVERSATION_ID)
  )
    throw new Error("Inconsistent or unassigned admission identity");

  for (const other of conversations) {
    if (other.id !== conversationId) {
      const otherProvider = await tx.doc(ProviderDoc, other.id);

      if (otherProvider.sessionId === provider.sessionId)
        throw new Error("Conflicting provider admission identity");
    }
  }

  const workspaces = await tx.doc(WorkspacesDoc);

  if (workspaces.effects.some((effect) => effect.status !== "observed"))
    throw new Error("Admission blocked by pending workspace effect");

  if (identity.role === "main") {
    if (identity.assignmentId !== null) throw new Error("Main has no assignment");
  } else {
    const assignment = workspaces.assignments.find((entry) => entry.id === identity.assignmentId);

    if (
      !identity.assignmentId ||
      !assignment ||
      assignment.status !== "admitted" ||
      !assignment.binding ||
      assignment.reservation.taskId !== taskId ||
      assignment.reservation.taskDirectory !== metadata.directory ||
      assignment.reservation.assignmentId !== assignment.id ||
      assignment.reservation.worktree !== assignment.worktree ||
      assignment.reservation.releaseId !== null ||
      assignment.binding.worktree !== assignment.worktree ||
      assignment.binding.branch !== assignment.branch ||
      assignment.binding.commonDirectory !== workspaces.repository?.commonDirectory
    )
      throw new Error("Admission requires an owned admitted assignment");
  }

  return { metadata, identity, workspaces };
}

// Existing conversations only, before any table write. Worker creation must use
// createAdmittedConversation: SDK 1.4.0 facade init runs after its first table write.
// Exact retries are idempotent; retry/reopen never renew deadlines.
export async function initializeAdmission(
  tx: Tx,
  taskId: string,
  conversationId: ConversationId,
  input: AdmissionInputs,
  authority: string,
) {
  return initializeAdmissionWithConversations(tx, taskId, conversationId, input, authority);
}

async function initializeAdmissionWithConversations(
  tx: Tx,
  taskId: string,
  conversationId: ConversationId,
  input: AdmissionInputs,
  authority: string,
  conversations?: readonly ConversationRecord[],
) {
  if (!authority.trim()) throw new Error("Admission requires explicit host authority");
  const normalized = normalizeInputs(input);

  const { metadata, identity, workspaces } = await ownedIdentity(
    tx,
    taskId,
    conversationId,
    conversations,
  );

  if (identity.role !== normalized.profile.role) throw new Error("Admission role mismatch");

  if (identity.role === "main") {
    if (normalized.profile.cwd !== metadata.repositoryRoot)
      throw new Error("Admission cwd mismatch");
  } else {
    const assignment = workspaces.assignments.find((entry) => entry.id === identity.assignmentId);

    if (
      !assignment ||
      normalized.profile.cwd !== assignment.worktree ||
      (normalized.profile.role === "writer" &&
        normalized.profile.writePaths.some((path) => !assignment.writePaths.includes(path)))
    )
      throw new Error("Admission profile differs from assignment scope");
  }

  const document = await tx.doc(AdmissionDoc, conversationId);

  const record: AdmissionRecord = {
    ...normalized,
    profile: {
      ...normalized.profile,
      writePaths: [...normalized.profile.writePaths],
      checkIds: [...normalized.profile.checkIds],
    },
    taskId,
    taskDirectory: metadata.directory,
    conversationId,
    providerSessionId: identity.providerSessionId,
    assignmentId: identity.assignmentId,
    profileFingerprint: admissionProfileFingerprint(normalized.profile),
    authority,
    configuration: null,
    pendingEffectIds: [],
  };

  if (document.record) {
    const previous = document.record;

    if (
      JSON.stringify({ ...previous, configuration: null, pendingEffectIds: [] }) !==
      JSON.stringify(record)
    )
      throw new Error("Admission inputs are immutable; retry cannot replace them");

    return;
  }

  document.record = record;
}

export type AdmissionExpectation = {
  taskId: string;
  conversationId: ConversationId;
  providerSessionId: string;
  profileFingerprint: string;
  contextFingerprint: string;
  sourceFingerprint: string;
};

// T6 calls this INSIDE its reservation transaction. This is metadata evidence only:
// T5 must install exact tools/extensions and its guarded environment atomically with
// the configuration receipt. T6 still enforces consumed counters and time limits.
export async function requireAdmission(tx: Tx, expected: AdmissionExpectation) {
  return requireAdmissionWithConversations(tx, expected);
}

async function requireAdmissionWithConversations(
  tx: Tx,
  expected: AdmissionExpectation,
  conversations?: readonly ConversationRecord[],
) {
  const { metadata, identity, workspaces } = await ownedIdentity(
    tx,
    expected.taskId,
    expected.conversationId,
    conversations,
  );

  const record = (await tx.doc(AdmissionDoc, expected.conversationId)).record;

  if (!record) throw new Error("Absent or fork-inherited admission");
  const normalized = normalizeInputs(record);

  if (identity.role === "main") {
    if (normalized.profile.cwd !== metadata.repositoryRoot)
      throw new Error("Admission cwd mismatch");
  } else {
    const assignment = workspaces.assignments.find((entry) => entry.id === identity.assignmentId);

    if (
      !assignment ||
      normalized.profile.cwd !== assignment.worktree ||
      (normalized.profile.role === "writer" &&
        normalized.profile.writePaths.some((path) => !assignment.writePaths.includes(path)))
    )
      throw new Error("Admission profile differs from assignment scope");
  }

  if (
    record.taskId !== expected.taskId ||
    record.taskDirectory !== metadata.directory ||
    record.conversationId !== expected.conversationId ||
    record.providerSessionId !== expected.providerSessionId ||
    record.providerSessionId !== identity.providerSessionId ||
    record.assignmentId !== identity.assignmentId ||
    record.profile.role !== identity.role ||
    record.profileFingerprint !== admissionProfileFingerprint(record.profile) ||
    record.profileFingerprint !== expected.profileFingerprint ||
    record.contextFingerprint !== expected.contextFingerprint ||
    record.sourceFingerprint !== expected.sourceFingerprint
  )
    throw new Error("Admission ownership/profile/source mismatch");

  if (
    !record.configuration ||
    record.configuration.profileFingerprint !== record.profileFingerprint
  )
    throw new Error("Incomplete admission configuration");
  requireFingerprint(record.configuration.environmentFingerprint);

  if (record.pendingEffectIds.length) throw new Error("Admission blocked by pending effect");

  return { ...copyAdmission(record), profile: normalized.profile } satisfies ValidatedAdmission;
}

// The callback must configure the REAL SDK agent in this transaction; a receipt
// alone is not proof of capability enforcement. Never expose this to the model.
export async function configureAdmission(
  tx: Tx,
  taskId: string,
  conversationId: ConversationId,
  environmentFingerprint: string,
  configure: (tx: Tx, admission: Readonly<ValidatedAdmission>) => Promise<void>,
) {
  return configureAdmissionWithConversations(
    tx,
    taskId,
    conversationId,
    environmentFingerprint,
    configure,
  );
}

type ConfigureAdmission = (tx: Tx, admission: Readonly<ValidatedAdmission>) => Promise<void>;

async function configureAdmissionWithConversations(
  tx: Tx,
  taskId: string,
  conversationId: ConversationId,
  environmentFingerprint: string,
  configure: ConfigureAdmission,
  conversations?: readonly ConversationRecord[],
) {
  await ownedIdentity(tx, taskId, conversationId, conversations);
  requireFingerprint(environmentFingerprint);
  const document = await tx.doc(AdmissionDoc, conversationId);
  const record = document.record;

  if (!record || record.taskId !== taskId || record.conversationId !== conversationId)
    throw new Error("Configuration requires matching initialized admission");

  if (record.configuration) throw new Error("Admission configuration is immutable");
  const normalized = normalizeInputs(record);
  await configure(tx, { ...copyAdmission(record), profile: normalized.profile });
  record.configuration = { profileFingerprint: record.profileFingerprint, environmentFingerprint };
}

export type AdmittedConversationOptions = {
  ownership: ConversationOwnership;
  assignmentId: string;
  input: AdmissionInputs;
  authority: string;
  environmentFingerprint: string;
  configure: ConfigureAdmission;
};

// Host-only, one SDK commit: all table reads precede createConversation. Only this
// helper can supply private creation evidence, from the actual SDK return value.
// configure must establish real agent/environment configuration, not create/fork
// additional conversations. No scheduling or external effects belong in this callback.
export function createAdmittedConversation(
  host: DurableTaskHost,
  options: AdmittedConversationOptions,
  context: Context,
) {
  const input = normalizeInputs(options.input);
  const { ownership, assignmentId, authority, environmentFingerprint, configure } = options;
  const selectedOwnership = { ...ownership };

  if (input.profile.role === "main") throw new Error("Worker creation cannot admit main");

  if (!authority.trim()) throw new Error("Admission requires explicit host authority");
  requireFingerprint(environmentFingerprint);

  return host.harness.commit(async (tx) => {
    const conversations = await admissionConversations(tx);
    await ownedIdentity(tx, host.taskId, ROOT_CONVERSATION_ID, conversations);
    const conversation = await tx.createConversation({ ownership: selectedOwnership });
    const identity = await tx.doc(ConversationIdentityDoc, conversation.id);
    const admission = await tx.doc(AdmissionDoc, conversation.id);

    if (
      conversations.some((entry) => entry.id === conversation.id) ||
      conversation.parent ||
      identity.role !== "unassigned" ||
      identity.assignmentId !== null ||
      admission.record !== null
    )
      throw new Error("New worker requires fresh, uninherited identity/admission");
    conversations.push(conversation);
    identity.role = input.profile.role;
    identity.assignmentId = assignmentId;
    await initializeAdmissionWithConversations(
      tx,
      host.taskId,
      conversation.id,
      input,
      authority,
      conversations,
    );
    const providerSessionId = identity.providerSessionId;
    await configureAdmissionWithConversations(
      tx,
      host.taskId,
      conversation.id,
      environmentFingerprint,
      configure,
      conversations,
    );
    await requireAdmissionWithConversations(
      tx,
      {
        taskId: host.taskId,
        conversationId: conversation.id,
        providerSessionId,
        profileFingerprint: admissionProfileFingerprint(input.profile),
        contextFingerprint: input.contextFingerprint,
        sourceFingerprint: input.sourceFingerprint,
      },
      conversations,
    );

    return conversation;
  }, context);
}

// Inspection uses T3's identity validation and snapshots only; no progress API.
export async function inspectAdmission(
  host: DurableTaskHost,
  conversationId: ConversationId,
  context: Context,
) {
  const view = await host.inspect(context);

  if (!view.identities.some((identity) => identity.conversationId === conversationId))
    throw new Error("Unknown admission conversation");

  return host.harness.snapshot(AdmissionDoc, conversationId, context);
}

function copyAdmission(record: AdmissionRecord): AdmissionRecord {
  return {
    ...record,
    profile: {
      ...record.profile,
      writePaths: [...record.profile.writePaths],
      checkIds: [...record.profile.checkIds],
    },
    configuration: record.configuration ? { ...record.configuration } : null,
    pendingEffectIds: [...record.pendingEffectIds],
  };
}
