import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import type { ConversationBinding } from "./task-state.js";
import type { GitBinding } from "./workspace-git.js";

export type VerificationArtifact = Readonly<{
  kind:
    | "intent"
    | "source"
    | "caller"
    | "test"
    | "configuration"
    | "context"
    | "patterns"
    | "guidance"
    | "evidence";
  path: string;
  sha256: string;
  revision: string;
}>;

export type VerificationIdentity = Readonly<{ id: string; sha256: string }>;

export type CandidateManifest = Readonly<{
  formatVersion: 1;
  taskId: string;
  git: Readonly<GitBinding>;
  base: string;
  indexHash: string;
  artifacts: readonly VerificationArtifact[];
  profile: VerificationIdentity;
  runtime: VerificationIdentity;
  policy: VerificationIdentity;
  sdkVersions: Readonly<{ durable: string; ai: string; chord: string; codingAgent: string }>;
  nodeVersion: string;
  model: Readonly<{ provider: string; model: string; thinking: string }>;
}>;

export type VerificationParticipant = Readonly<
  ConversationBinding & { taskId: string; profileHash: string }
>;

export type VerificationCheck = Readonly<{
  id: string;
  profileHash: string;
  commandHash: string;
  expectationsHash: string;
}>;

export type VerificationPacket = Readonly<{
  candidate: CandidateManifest;
  authors: readonly VerificationParticipant[];
  repairProposers: readonly VerificationParticipant[];
  reviewers: readonly [VerificationParticipant, VerificationParticipant];
  verifier: VerificationParticipant;
  checks: readonly VerificationCheck[];
}>;

export type VerificationEvidence = Readonly<{
  packetHash: string;
  candidateHash: string;
  verifier: VerificationParticipant;
  checkId: string;
  profileHash: string;
  commandHash: string;
  expectationsHash: string;
  sourceBeforeHash: string;
  sourceAfterHash: string;
  indexBeforeHash: string;
  indexAfterHash: string;
  disposition: "pass" | "fail" | "blocked";
  outputHash: string;
  observationsHash: string;
  cleanupHash: string;
}>;

/** Pure data contracts only: callers must obtain actual Git/file/SDK observations and enforce roles.
 * Hash agreement is neither source verification, proof of execution, nor live readiness.
 * Inputs are typed host data, not a decoder for untrusted JSON or credential-bearing configuration.
 */
export function hashVerificationContent(content: string | Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}

function text(value: string, field: string) {
  if (String(value) !== value || !value.trim() || value.includes("\0")) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

function hash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(text(value, "SHA-256"))) throw new Error("Invalid SHA-256");

  return value;
}

function commit(value: string) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(value, "Git commit"))) {
    throw new Error("Invalid Git commit");
  }

  return value;
}

function path(value: string) {
  if (!isAbsolute(text(value, "absolute path"))) throw new Error("Expected absolute path");

  return value;
}

function fileIdentity(value: string) {
  if (!/^[0-9]+$/.test(text(value, "filesystem identity"))) {
    throw new Error("Invalid filesystem identity");
  }

  return value;
}

function versionedIdentity(value: VerificationIdentity) {
  return Object.freeze({ id: text(value.id, "versioned identity"), sha256: hash(value.sha256) });
}

function artifact(value: VerificationArtifact): VerificationArtifact {
  if (
    ![
      "intent",
      "source",
      "caller",
      "test",
      "configuration",
      "context",
      "patterns",
      "guidance",
      "evidence",
    ].includes(value.kind)
  )
    throw new Error("Invalid artifact kind");

  return Object.freeze({
    kind: value.kind,
    path: text(value.path, "artifact path"),
    sha256: hash(value.sha256),
    revision: text(value.revision, "artifact revision"),
  });
}

/** Freeze an explicit, order-independent manifest of all material inputs selected by the host. */
export function createCandidateManifest(input: CandidateManifest): CandidateManifest {
  if (input.formatVersion !== 1) throw new Error("Unsupported candidate manifest version");

  const artifacts = input.artifacts.map(artifact);
  artifacts.sort((left, right) => {
    const a = JSON.stringify([left.kind, left.path]);
    const b = JSON.stringify([right.kind, right.path]);

    return a < b ? -1 : a > b ? 1 : 0;
  });
  const names = new Set<string>();
  const contentHashes = new Map<string, string>();

  for (const item of artifacts) {
    const key = JSON.stringify([item.kind, item.path]);
    const contentKey = JSON.stringify([item.path, item.revision]);
    const previousHash = contentHashes.get(contentKey);

    if (names.has(key)) throw new Error("Duplicate candidate artifact");

    if (previousHash !== undefined && previousHash !== item.sha256) {
      throw new Error("Conflicting candidate artifact content identity");
    }

    names.add(key);
    contentHashes.set(contentKey, item.sha256);
  }

  for (const kind of [
    "intent",
    "source",
    "caller",
    "test",
    "configuration",
    "context",
    "patterns",
    "guidance",
  ]) {
    if (!artifacts.some((item) => item.kind === kind)) {
      throw new Error(`Missing candidate ${kind} manifest`);
    }
  }

  const versions = input.sdkVersions;

  if (
    [versions.durable, versions.ai, versions.chord, versions.codingAgent].some((v) => v !== "1.4.0")
  ) {
    throw new Error("Unsupported verification SDK versions");
  }

  const git = input.git;

  return Object.freeze({
    formatVersion: 1,
    taskId: text(input.taskId, "task ID"),
    git: Object.freeze({
      worktree: path(git.worktree),
      device: fileIdentity(git.device),
      inode: fileIdentity(git.inode),
      commonDirectory: path(git.commonDirectory),
      commonDevice: fileIdentity(git.commonDevice),
      commonInode: fileIdentity(git.commonInode),
      branch: text(git.branch, "branch"),
      head: commit(git.head),
      sourceHash: hash(git.sourceHash),
    }),
    base: commit(input.base),
    indexHash: hash(input.indexHash),
    artifacts: Object.freeze(artifacts),
    profile: versionedIdentity(input.profile),
    runtime: versionedIdentity(input.runtime),
    policy: versionedIdentity(input.policy),
    sdkVersions: Object.freeze({
      durable: versions.durable,
      ai: versions.ai,
      chord: versions.chord,
      codingAgent: versions.codingAgent,
    }),
    nodeVersion: text(input.nodeVersion, "Node version"),
    model: Object.freeze({
      provider: text(input.model.provider, "model provider"),
      model: text(input.model.model, "model ID"),
      thinking: text(input.model.thinking, "thinking level"),
    }),
  });
}

export function candidateManifestHash(input: CandidateManifest) {
  return hashVerificationContent(JSON.stringify(createCandidateManifest(input)));
}

function participant(input: VerificationParticipant, taskId: string): VerificationParticipant {
  if (
    input.taskId !== taskId ||
    !Number.isSafeInteger(input.conversationId) ||
    input.conversationId <= 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      input.providerSessionId,
    ) ||
    !["writer", "reviewer", "verifier"].includes(input.role) ||
    input.assignmentId === null
  )
    throw new Error("Invalid verification participant binding");

  return Object.freeze({
    taskId,
    conversationId: input.conversationId,
    providerSessionId: input.providerSessionId,
    role: input.role,
    assignmentId: text(input.assignmentId, "assignment ID"),
    profileHash: hash(input.profileHash),
  });
}

function overlaps(left: VerificationParticipant, right: VerificationParticipant) {
  return (
    left.conversationId === right.conversationId ||
    left.providerSessionId === right.providerSessionId ||
    left.assignmentId === right.assignmentId
  );
}

function independent(people: readonly VerificationParticipant[]) {
  for (const [index, person] of people.entries()) {
    if (people.slice(0, index).some((other) => overlaps(person, other))) {
      throw new Error("Verification roles require independent identities");
    }
  }
}

function consistentParticipantBindings(people: readonly VerificationParticipant[]) {
  const sessions = new Map<VerificationParticipant["conversationId"], string>();
  const conversations = new Map<string, VerificationParticipant["conversationId"]>();

  for (const person of people) {
    const session = sessions.get(person.conversationId);
    const conversation = conversations.get(person.providerSessionId);

    if (
      (session !== undefined && session !== person.providerSessionId) ||
      (conversation !== undefined && conversation !== person.conversationId)
    )
      throw new Error("Conflicting conversation/provider-session binding");

    sessions.set(person.conversationId, person.providerSessionId);
    conversations.set(person.providerSessionId, person.conversationId);
  }
}

export function createVerificationPacket(input: VerificationPacket): VerificationPacket {
  const candidate = createCandidateManifest(input.candidate);
  const authors = input.authors.map((value) => participant(value, candidate.taskId));

  const repairProposers = input.repairProposers.map((value) =>
    participant(value, candidate.taskId),
  );

  if (!authors.length || authors.some((value) => value.role !== "writer")) {
    throw new Error("Candidate requires writer identities");
  }

  if (input.reviewers.length !== 2) throw new Error("Exactly two initial reviewers required");

  const reviewers = Object.freeze([
    participant(input.reviewers[0], candidate.taskId),
    participant(input.reviewers[1], candidate.taskId),
  ] as const);

  const verifier = participant(input.verifier, candidate.taskId);

  if (reviewers.some((value) => value.role !== "reviewer") || verifier.role !== "verifier") {
    throw new Error("Incorrect review or verifier role");
  }

  independent([...authors, ...reviewers, verifier]);
  independent(repairProposers);

  if (repairProposers.some((value) => overlaps(verifier, value))) {
    throw new Error("Fresh verifier cannot have proposed repairs");
  }

  consistentParticipantBindings([...authors, ...reviewers, verifier, ...repairProposers]);

  const checks = input.checks.map((value) =>
    Object.freeze({
      id: text(value.id, "check ID"),
      profileHash: hash(value.profileHash),
      commandHash: hash(value.commandHash),
      expectationsHash: hash(value.expectationsHash),
    }),
  );

  checks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (!checks.length || new Set(checks.map((value) => value.id)).size !== checks.length) {
    throw new Error("Required checks must be nonempty and unique");
  }

  return Object.freeze({
    candidate,
    authors: Object.freeze(authors),
    repairProposers: Object.freeze(repairProposers),
    reviewers,
    verifier,
    checks: Object.freeze(checks),
  });
}

export function verificationPacketHash(input: VerificationPacket) {
  return hashVerificationContent(JSON.stringify(createVerificationPacket(input)));
}

/** Validate receipt bindings, not the truth of claimed observations or executed commands.
 * Supply a previously pinned evidence hash when reusing a receipt after initial collection.
 */
export function validateVerificationEvidence(
  input: VerificationPacket,
  actualCandidate: CandidateManifest,
  evidence: VerificationEvidence,
  expectedEvidenceHash?: string,
): VerificationEvidence {
  const packet = createVerificationPacket(input);
  const candidateHash = candidateManifestHash(packet.candidate);
  const verifier = participant(evidence.verifier, packet.candidate.taskId);
  const check = packet.checks.find((value) => value.id === evidence.checkId);

  if (
    candidateManifestHash(actualCandidate) !== candidateHash ||
    evidence.candidateHash !== candidateHash ||
    evidence.packetHash !== verificationPacketHash(packet) ||
    JSON.stringify(verifier) !== JSON.stringify(packet.verifier) ||
    !check ||
    evidence.profileHash !== check.profileHash ||
    evidence.commandHash !== check.commandHash ||
    evidence.expectationsHash !== check.expectationsHash ||
    evidence.sourceBeforeHash !== packet.candidate.git.sourceHash ||
    evidence.sourceAfterHash !== packet.candidate.git.sourceHash ||
    evidence.indexBeforeHash !== packet.candidate.indexHash ||
    evidence.indexAfterHash !== packet.candidate.indexHash
  )
    throw new Error("Stale or mismatched verification evidence");

  if (!["pass", "fail", "blocked"].includes(evidence.disposition)) {
    throw new Error("Invalid verification disposition");
  }

  const validated = Object.freeze({
    packetHash: hash(evidence.packetHash),
    candidateHash: hash(evidence.candidateHash),
    verifier,
    checkId: check.id,
    profileHash: check.profileHash,
    commandHash: check.commandHash,
    expectationsHash: check.expectationsHash,
    sourceBeforeHash: hash(evidence.sourceBeforeHash),
    sourceAfterHash: hash(evidence.sourceAfterHash),
    indexBeforeHash: hash(evidence.indexBeforeHash),
    indexAfterHash: hash(evidence.indexAfterHash),
    disposition: evidence.disposition,
    outputHash: hash(evidence.outputHash),
    observationsHash: hash(evidence.observationsHash),
    cleanupHash: hash(evidence.cleanupHash),
  });

  if (
    expectedEvidenceHash !== undefined &&
    hashVerificationContent(JSON.stringify(validated)) !== hash(expectedEvidenceHash)
  )
    throw new Error("Changed verification evidence identity");

  return validated;
}

/** Pin this digest with any later audit: changing output, observations, cleanup or disposition
 * changes the evidence identity even when its candidate binding is unchanged.
 */
export function verificationEvidenceHash(
  packet: VerificationPacket,
  actualCandidate: CandidateManifest,
  evidence: VerificationEvidence,
) {
  return hashVerificationContent(
    JSON.stringify(validateVerificationEvidence(packet, actualCandidate, evidence)),
  );
}

/** A data-only completeness check. Even "pass" requires subsequent actual SDK/lead audit. */
export function verificationEvidenceDisposition(
  packet: VerificationPacket,
  actualCandidate: CandidateManifest,
  receipts: readonly VerificationEvidence[],
): "pass" | "fail" | "blocked" {
  const frozen = createVerificationPacket(packet);
  const seen = new Set<string>();
  let disposition: "pass" | "fail" | "blocked" = "pass";

  if (candidateManifestHash(actualCandidate) !== candidateManifestHash(frozen.candidate)) {
    throw new Error("Stale candidate");
  }

  for (const receipt of receipts) {
    const value = validateVerificationEvidence(frozen, actualCandidate, receipt);

    if (seen.has(value.checkId)) throw new Error("Duplicate verification check evidence");

    seen.add(value.checkId);

    if (value.disposition === "fail") disposition = "fail";
    else if (value.disposition === "blocked" && disposition !== "fail") disposition = "blocked";
  }

  if (disposition === "pass" && seen.size !== frozen.checks.length) return "blocked";

  return disposition;
}
