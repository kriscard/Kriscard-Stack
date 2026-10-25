import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, test } from "vitest";

import { DurableTaskHost } from "../../src/durable/task-host.js";
import { ConversationIdentityDoc } from "../../src/durable/task-state.js";
import {
  candidateManifestHash,
  createCandidateManifest,
  createVerificationPacket,
  hashVerificationContent,
  validateVerificationEvidence,
  verificationEvidenceDisposition,
  verificationEvidenceHash,
  verificationPacketHash,
  type CandidateManifest,
  type VerificationArtifact,
  type VerificationEvidence,
  type VerificationPacket,
  type VerificationParticipant,
} from "../../src/durable/verification.js";
import { inspectGit } from "../../src/durable/workspace-git.js";

const context = BACKGROUND_CONTEXT;

function git(cwd: string, args: string[]) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  return execFileSync(
    "git",
    [
      "--literal-pathspecs",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...environment, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function fileHash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function installedVersion(name: string) {
  const manifest = readFileSync(
    join(process.cwd(), "packages/pi-runner/node_modules/@earendil-works", name, "package.json"),
    "utf8",
  );

  const version = /"version":\s*"([^"]+)"/.exec(manifest)?.[1];

  if (!version) throw new Error(`Missing installed ${name} version`);

  return version;
}

async function fixture(
  check: (
    packet: VerificationPacket,
    receipt: VerificationEvidence,
    repository: string,
    additionalProposer: VerificationParticipant,
  ) => Promise<void> | void,
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kstack-verification-")));
  const repository = join(directory, "repository");
  let host: DurableTaskHost | undefined;

  try {
    mkdirSync(repository);
    git(repository, ["init", "-b", "main"]);

    const files: readonly [VerificationArtifact["kind"], string, string][] = [
      ["intent", "intent.md", "Validate immutable metadata, not live readiness.\n"],
      ["source", "source.txt", "original source\n"],
      ["caller", "caller.txt", "fixture consumer\n"],
      ["test", "test.txt", "node --version must match the current executable\n"],
      ["configuration", "config.json", '{"dependencies":"frozen"}\n'],
      ["context", "instructions.md", "Retain actual command outputs.\n"],
      ["patterns", "patterns.md", "Use the existing SDK host.\n"],
      [
        "guidance",
        "guidance.md",
        "Pure data fixture guidance, not installed implementation guidance.\n",
      ],
      ["evidence", "prior-evidence.txt", "Setup fixture evidence, not runtime readiness.\n"],
    ];

    for (const [, name, content] of files) writeFileSync(join(repository, name), content);

    git(repository, ["add", "."]);
    git(repository, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "verification fixture",
    ]);
    const revision = git(repository, ["rev-parse", "HEAD"]).trim();

    const artifacts = files.map(([kind, name]) => ({
      kind,
      path: name,
      sha256: fileHash(join(repository, name)),
      revision,
    }));

    const configHash = fileHash(join(repository, "config.json"));
    host = await DurableTaskHost.start(
      { repositoryRoot: repository, stateDir: join(directory, "state"), models: createModels() },
      context,
    );

    const candidate: CandidateManifest = {
      formatVersion: 1,
      taskId: host.taskId,
      git: inspectGit(repository),
      base: revision,
      indexHash: hashVerificationContent(git(repository, ["ls-files", "--stage", "-z"])),
      artifacts,
      profile: { id: "fixture-profile-v1", sha256: configHash },
      runtime: { id: "fixture-runtime-metadata-v1", sha256: configHash },
      policy: { id: "fixture-policy-metadata-v1", sha256: configHash },
      sdkVersions: {
        durable: installedVersion("pi-durable"),
        ai: installedVersion("pi-ai"),
        chord: installedVersion("chord"),
        codingAgent: installedVersion("pi-coding-agent"),
      },
      nodeVersion: process.version,
      model: { provider: "none", model: "no-generation-in-pure-fixture", thinking: "off" },
    };

    const people: VerificationParticipant[] = [];

    for (const [index, role] of [
      "writer",
      "reviewer",
      "reviewer",
      "verifier",
      "reviewer",
    ].entries()) {
      const conversation = await host.harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );

      const binding = await host.harness.commit(async (tx) => {
        const identity = await tx.doc(ConversationIdentityDoc, conversation.id);
        identity.role =
          role === "writer" ? "writer" : role === "reviewer" ? "reviewer" : "verifier";
        identity.assignmentId = `fixture-assignment-${index}`;

        return { ...identity, conversationId: conversation.id };
      }, context);

      people.push({ ...binding, taskId: host.taskId, profileHash: configHash });
    }

    const [author, first, second, verifier, additionalProposer] = people;

    if (!author || !first || !second || !verifier || !additionalProposer)
      throw new Error("Missing actual SDK fixture identities");

    const commandHash = hashVerificationContent(JSON.stringify([process.execPath, "--version"]));

    const output = execFileSync(process.execPath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(output.trim()).toBe(process.version);

    const packet = createVerificationPacket({
      candidate: { ...candidate, taskId: host.taskId },
      authors: [author],
      repairProposers: [first],
      reviewers: [first, second],
      verifier,
      checks: [
        {
          id: "node-version",
          profileHash: configHash,
          commandHash,
          expectationsHash: hashVerificationContent(process.version),
        },
      ],
    });

    const receipt: VerificationEvidence = {
      packetHash: verificationPacketHash(packet),
      candidateHash: candidateManifestHash(packet.candidate),
      verifier,
      checkId: "node-version",
      profileHash: configHash,
      commandHash,
      expectationsHash: hashVerificationContent(process.version),
      sourceBeforeHash: candidate.git.sourceHash,
      sourceAfterHash: candidate.git.sourceHash,
      indexBeforeHash: candidate.indexHash,
      indexAfterHash: candidate.indexHash,
      disposition: "pass",
      outputHash: hashVerificationContent(output),
      observationsHash: hashVerificationContent(
        `Observed ${output.trim()} from the real node executable`,
      ),
      cleanupHash: hashVerificationContent(
        "Synchronous fixture child exited; no generated model requests.",
      ),
    };

    await check(packet, receipt, repository, additionalProposer);
  } finally {
    if (host) await host.close(context);

    rmSync(directory, { recursive: true, force: true });
  }
}

test("verification hashes exact bytes with the standard SHA-256 digest", () => {
  expect(hashVerificationContent("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(hashVerificationContent(new TextEncoder().encode("abc"))).toBe(
    hashVerificationContent("abc"),
  );
});

test("candidate manifests copy and deeply freeze inputs and normalize artifact ordering", async () => {
  await fixture((packet) => {
    const artifacts = packet.candidate.artifacts.map((value) => ({ ...value }));
    const candidate = createCandidateManifest({ ...packet.candidate, artifacts });
    const expected = candidateManifestHash(candidate);
    artifacts.reverse();
    expect(candidateManifestHash({ ...packet.candidate, artifacts })).toBe(expected);
    const item = artifacts[0];

    if (!item) throw new Error("Missing artifact");

    item.sha256 = hashVerificationContent("changed input");
    expect(candidateManifestHash(candidate)).toBe(expected);
    expect(candidateManifestHash({ ...packet.candidate, artifacts })).not.toBe(expected);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.git)).toBe(true);
    expect(Object.isFrozen(candidate.artifacts)).toBe(true);
    expect(candidate.artifacts.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(candidate.runtime)).toBe(true);
    expect(Object.isFrozen(packet.reviewers)).toBe(true);
    expect(Object.isFrozen(packet.verifier)).toBe(true);
  });
});

test("candidate hashing binds repository, base/head, source/index, context, guidance, evidence and D11 metadata", async () => {
  await fixture((packet) => {
    const candidate = packet.candidate;
    const changed = hashVerificationContent("different actual bytes");

    const variants: CandidateManifest[] = [
      { ...candidate, taskId: "different-task" },
      { ...candidate, git: { ...candidate.git, inode: `${candidate.git.inode}0` } },
      { ...candidate, git: { ...candidate.git, commonInode: `${candidate.git.commonInode}0` } },
      { ...candidate, git: { ...candidate.git, worktree: `${candidate.git.worktree}-other` } },
      { ...candidate, git: { ...candidate.git, branch: "other" } },
      { ...candidate, git: { ...candidate.git, head: changed } },
      { ...candidate, base: changed },
      { ...candidate, git: { ...candidate.git, sourceHash: changed } },
      { ...candidate, indexHash: changed },
      { ...candidate, profile: { ...candidate.profile, id: "other" } },
      { ...candidate, profile: { ...candidate.profile, sha256: changed } },
      { ...candidate, runtime: { ...candidate.runtime, id: "other" } },
      { ...candidate, runtime: { ...candidate.runtime, sha256: changed } },
      { ...candidate, policy: { ...candidate.policy, id: "other" } },
      { ...candidate, policy: { ...candidate.policy, sha256: changed } },
      { ...candidate, nodeVersion: "different-runtime" },
      { ...candidate, model: { ...candidate.model, model: "other" } },
    ];

    for (const item of candidate.artifacts) {
      variants.push({
        ...candidate,
        artifacts: candidate.artifacts.map((value) =>
          value === item ? { ...value, sha256: changed } : value,
        ),
      });
      variants.push({
        ...candidate,
        artifacts: candidate.artifacts.map((value) =>
          value === item ? { ...value, revision: "changed-revision" } : value,
        ),
      });
    }

    for (const variant of variants)
      expect(candidateManifestHash(variant)).not.toBe(candidateManifestHash(candidate));
  });
});

test("candidate manifests reject missing categories, duplicate artifacts, malformed hashes and incompatible SDKs", async () => {
  await fixture((packet) => {
    const input = packet.candidate;
    const first = input.artifacts[0];

    if (!first) throw new Error("Missing artifact");

    expect(() =>
      createCandidateManifest({ ...input, artifacts: [...input.artifacts, first] }),
    ).toThrow("Duplicate");
    expect(() =>
      createCandidateManifest({
        ...input,
        artifacts: input.artifacts.filter((value) => value.kind !== "guidance"),
      }),
    ).toThrow("Missing candidate guidance");
    expect(() => createCandidateManifest({ ...input, indexHash: "success" })).toThrow("SHA-256");
    expect(() =>
      createCandidateManifest({ ...input, git: { ...input.git, worktree: "relative" } }),
    ).toThrow("absolute");
    expect(() =>
      createCandidateManifest({
        ...input,
        sdkVersions: { ...input.sdkVersions, durable: "2.0.0" },
      }),
    ).toThrow("SDK");
  });
});

test("packets require two independent actual SDK reviewers and a verifier who neither authored nor proposed repairs", async () => {
  await fixture((packet) => {
    const [first, second] = packet.reviewers;
    expect(() => createVerificationPacket({ ...packet, reviewers: [first, first] })).toThrow(
      "independent",
    );
    expect(() =>
      createVerificationPacket({
        ...packet,
        reviewers: [first, { ...second, providerSessionId: first.providerSessionId }],
      }),
    ).toThrow("independent");
    expect(() =>
      createVerificationPacket({
        ...packet,
        reviewers: [first, { ...second, assignmentId: first.assignmentId }],
      }),
    ).toThrow("independent");
    expect(() =>
      createVerificationPacket({ ...packet, verifier: { ...first, role: "verifier" } }),
    ).toThrow("independent");
    expect(() =>
      createVerificationPacket({ ...packet, authors: [{ ...packet.verifier, role: "writer" }] }),
    ).toThrow("independent");
    expect(() =>
      createVerificationPacket({ ...packet, repairProposers: [packet.verifier] }),
    ).toThrow("proposed repairs");
    expect(() =>
      createVerificationPacket({
        ...packet,
        verifier: { ...packet.verifier, taskId: "wrong-task" },
      }),
    ).toThrow("binding");
    expect(() =>
      createVerificationPacket({
        ...packet,
        verifier: { ...packet.verifier, providerSessionId: "not-sdk-session" },
      }),
    ).toThrow("binding");
  });
});

test("receipt validation binds every identity, check definition and before/after source/index observation", async () => {
  await fixture((packet, receipt) => {
    expect(validateVerificationEvidence(packet, packet.candidate, receipt)).toEqual(receipt);
    const changed = hashVerificationContent("changed");

    const variants: VerificationEvidence[] = [
      { ...receipt, packetHash: changed },
      { ...receipt, candidateHash: changed },
      { ...receipt, verifier: { ...packet.verifier, profileHash: changed } },
      { ...receipt, verifier: { ...packet.verifier, assignmentId: "other" } },
      { ...receipt, verifier: packet.reviewers[0] },
      { ...receipt, checkId: "missing-check" },
      { ...receipt, profileHash: changed },
      { ...receipt, commandHash: changed },
      { ...receipt, expectationsHash: changed },
      { ...receipt, sourceBeforeHash: changed },
      { ...receipt, sourceAfterHash: changed },
      { ...receipt, indexBeforeHash: changed },
      { ...receipt, indexAfterHash: changed },
    ];

    for (const variant of variants)
      expect(() => validateVerificationEvidence(packet, packet.candidate, variant)).toThrow(
        "mismatched",
      );

    expect(() =>
      validateVerificationEvidence(packet, packet.candidate, { ...receipt, outputHash: "" }),
    ).toThrow("SHA-256");
    expect(() =>
      validateVerificationEvidence(packet, packet.candidate, { ...receipt, observationsHash: "" }),
    ).toThrow("SHA-256");
    expect(() =>
      validateVerificationEvidence(packet, packet.candidate, { ...receipt, cleanupHash: "" }),
    ).toThrow("SHA-256");
  });
});

test("real staged index changes remain stale after tracked worktree bytes are restored", async () => {
  await fixture((packet, receipt, repository) => {
    const name = join(repository, "source.txt");
    const original = readFileSync(name);
    writeFileSync(name, "changed staged bytes\n");
    git(repository, ["add", "source.txt"]);
    writeFileSync(name, original);

    const actual = createCandidateManifest({
      ...packet.candidate,
      git: inspectGit(repository),
      indexHash: hashVerificationContent(git(repository, ["ls-files", "--stage", "-z"])),
    });

    expect(actual.git.head).toBe(packet.candidate.git.head);
    expect(fileHash(name)).toBe(
      packet.candidate.artifacts.find((value) => value.kind === "source")?.sha256,
    );
    expect(actual.indexHash).not.toBe(packet.candidate.indexHash);
    expect(() => validateVerificationEvidence(packet, actual, receipt)).toThrow("Stale");
  });
});

test("real untracked source and changed configuration/context/guidance/evidence files invalidate previous receipts", async () => {
  await fixture((packet, receipt, repository) => {
    const kinds: VerificationArtifact["kind"][] = [
      "configuration",
      "context",
      "guidance",
      "evidence",
    ];

    for (const kind of kinds) {
      const item = packet.candidate.artifacts.find((value) => value.kind === kind);

      if (!item) throw new Error("Missing fixture artifact");

      const name = join(repository, item.path);
      const original = readFileSync(name);
      writeFileSync(name, "changed actual file\n");

      const actual = {
        ...packet.candidate,
        artifacts: packet.candidate.artifacts.map((value) =>
          value === item ? { ...value, sha256: fileHash(name) } : value,
        ),
      };

      expect(() => validateVerificationEvidence(packet, actual, receipt)).toThrow("Stale");
      writeFileSync(name, original);
    }

    writeFileSync(join(repository, "untracked.txt"), "material untracked input\n");
    expect(() =>
      validateVerificationEvidence(
        packet,
        { ...packet.candidate, git: inspectGit(repository) },
        receipt,
      ),
    ).toThrow("Stale");
  });
});

test("missing, failed and blocked evidence cannot become a passing data disposition", async () => {
  await fixture((packet, receipt) => {
    expect(verificationEvidenceDisposition(packet, packet.candidate, [receipt])).toBe("pass");
    expect(verificationEvidenceDisposition(packet, packet.candidate, [])).toBe("blocked");
    expect(
      verificationEvidenceDisposition(packet, packet.candidate, [
        { ...receipt, disposition: "fail" },
      ]),
    ).toBe("fail");
    expect(
      verificationEvidenceDisposition(packet, packet.candidate, [
        { ...receipt, disposition: "blocked" },
      ]),
    ).toBe("blocked");
    expect(() =>
      verificationEvidenceDisposition(packet, packet.candidate, [receipt, receipt]),
    ).toThrow("Duplicate");
    const check = packet.checks[0];

    if (!check) throw new Error("Missing check");

    const extended = createVerificationPacket({
      ...packet,
      checks: [...packet.checks, { ...check, id: "second-required-check" }],
    });

    const rebound = { ...receipt, packetHash: verificationPacketHash(extended) };
    expect(verificationEvidenceDisposition(extended, extended.candidate, [rebound])).toBe(
      "blocked",
    );
    expect(() => validateVerificationEvidence(extended, extended.candidate, receipt)).toThrow(
      "Stale",
    );
  });
});

test("evidence identity changes with output, observations, cleanup or reported disposition", async () => {
  await fixture((packet, receipt) => {
    const expected = verificationEvidenceHash(packet, packet.candidate, receipt);
    const changed = hashVerificationContent("different observed evidence bytes");

    const variants: VerificationEvidence[] = [
      { ...receipt, outputHash: changed },
      { ...receipt, observationsHash: changed },
      { ...receipt, cleanupHash: changed },
      { ...receipt, disposition: "fail" },
      { ...receipt, disposition: "blocked" },
    ];

    for (const variant of variants) {
      expect(verificationEvidenceHash(packet, packet.candidate, variant)).not.toBe(expected);
      expect(() =>
        validateVerificationEvidence(packet, packet.candidate, variant, expected),
      ).toThrow("Changed verification evidence identity");
    }

    const validated = validateVerificationEvidence(packet, packet.candidate, receipt, expected);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.verifier)).toBe(true);
  });
});

test("one path and revision retains one content identity across artifact categories", async () => {
  await fixture((packet) => {
    const source = packet.candidate.artifacts.find((value) => value.kind === "source");

    if (!source) throw new Error("Missing actual fixture source artifact");

    const shared: VerificationArtifact = { ...source, kind: "caller" };

    const accepted = createCandidateManifest({
      ...packet.candidate,
      artifacts: [...packet.candidate.artifacts, shared],
    });

    expect(accepted.artifacts).toContainEqual(source);
    expect(accepted.artifacts).toContainEqual(shared);

    const differentRevision = {
      ...shared,
      revision: "different-source-revision",
      sha256: hashVerificationContent("different revision content"),
    };

    expect(
      createCandidateManifest({
        ...packet.candidate,
        artifacts: [...packet.candidate.artifacts, differentRevision],
      }).artifacts,
    ).toContainEqual(differentRevision);
    expect(() =>
      createCandidateManifest({
        ...packet.candidate,
        artifacts: [
          ...packet.candidate.artifacts,
          { ...shared, sha256: hashVerificationContent("conflicting content") },
        ],
      }),
    ).toThrow("Conflicting candidate artifact content identity");
  });
});

test("repair proposers retain consistent actual SDK conversation and provider-session bindings", async () => {
  await fixture((packet, _receipt, _repository, additionalProposer) => {
    const [first, second] = packet.reviewers;
    const author = packet.authors[0];

    if (!author) throw new Error("Missing actual SDK author identity");

    const repeated = createVerificationPacket({
      ...packet,
      repairProposers: [first, author, additionalProposer],
    });

    expect(repeated.repairProposers).toEqual([first, author, additionalProposer]);

    for (const hybrid of [
      { ...first, providerSessionId: second.providerSessionId },
      { ...second, providerSessionId: first.providerSessionId },
      { ...author, providerSessionId: first.providerSessionId },
      { ...first, providerSessionId: author.providerSessionId },
      { ...additionalProposer, providerSessionId: first.providerSessionId },
      { ...first, providerSessionId: additionalProposer.providerSessionId },
    ]) {
      expect(() => createVerificationPacket({ ...packet, repairProposers: [hybrid] })).toThrow(
        "Conflicting conversation/provider-session binding",
      );
    }
  });
});
