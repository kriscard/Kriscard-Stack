import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  AgentDoc,
  defineExtension,
  defineTask,
  configure as configureAgent,
  ProviderDoc,
  ROOT_CONVERSATION_ID,
  type CommitPublication,
  type ConversationId,
  type Tx,
} from "@earendil-works/pi-durable";
import { expect, test } from "vitest";

import {
  AdmissionDoc,
  admissionProfileFingerprint,
  configureAdmission,
  createAdmittedConversation,
  initializeAdmission,
  inspectAdmission,
  requireAdmission,
  type AdmissionExpectation,
  type AdmissionInputs,
} from "../../src/durable/admission-state.js";
import { createRoleProfile } from "../../src/durable/inputs.js";
import { DurableTaskHost } from "../../src/durable/task-host.js";
import { ConversationIdentityDoc } from "../../src/durable/task-state.js";
import { inspectGit } from "../../src/durable/workspace-git.js";
import { WorkspacesDoc } from "../../src/durable/workspace-state.js";

const context = BACKGROUND_CONTEXT;

const hash = "a".repeat(64);

const environmentHash = "b".repeat(64);

const authority = "Operator approved disposable admission fixture";

function git(cwd: string, args: string[]) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  ).trim();
}

const AdmissionAnchor = defineTask<null, { phase: "finish" }, null>({
  name: "kstack.admission-repair-anchor",
  version: 1,
  initial: () => ({ phase: "finish" }),
  phases: {
    finish: (_task, runtime, ctx) =>
      runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        ctx,
      ),
  },
  abort: (_task, runtime, ctx) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

const admissionExtension = defineExtension({ name: "admission-fixture", tasks: [AdmissionAnchor] });

async function fixture(
  check: (
    host: DurableTaskHost,
    directory: string,
    input: AdmissionInputs,
    expected: AdmissionExpectation,
  ) => Promise<void>,
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kstack-admission-")));
  const repositoryRoot = join(directory, "repository");
  mkdirSync(repositoryRoot);
  git(repositoryRoot, ["init", "-b", "main"]);
  writeFileSync(join(repositoryRoot, "file.txt"), "fixture\n");
  git(repositoryRoot, ["add", "file.txt"]);
  git(repositoryRoot, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);

  const host = await DurableTaskHost.start(
    {
      repositoryRoot,
      stateDir: join(directory, "state"),
      models: createModels(),
      extensions: [admissionExtension],
    },
    context,
  );

  const input: AdmissionInputs = {
    profile: createRoleProfile({
      role: "main",
      cwd: repositoryRoot,
      writePaths: [],
      checkIds: [],
      contextLimitBytes: 1000,
    }),
    contextFingerprint: hash,
    sourceFingerprint: hash,
    admittedAt: 1000,
    deadline: 601000,
  };

  const view = await host.inspect(context);
  const identity = view.identities.find((entry) => entry.conversationId === ROOT_CONVERSATION_ID);

  if (!identity) throw new Error("Missing real root identity");

  const expected = {
    taskId: host.taskId,
    conversationId: ROOT_CONVERSATION_ID,
    providerSessionId: identity.providerSessionId,
    profileFingerprint: admissionProfileFingerprint(input.profile),
    contextFingerprint: hash,
    sourceFingerprint: hash,
  };

  try {
    await check(host, directory, input, expected);
  } finally {
    await host.close(context);
    rmSync(directory, { recursive: true, force: true });
  }
}

async function initialize(host: DurableTaskHost, input: AdmissionInputs) {
  await host.harness.commit(
    (tx) => initializeAdmission(tx, host.taskId, ROOT_CONVERSATION_ID, input, authority),
    context,
  );
}

async function configure(host: DurableTaskHost) {
  await host.harness.commit(
    (tx) =>
      configureAdmission(
        tx,
        host.taskId,
        ROOT_CONVERSATION_ID,
        environmentHash,
        async (configurationTx) => {
          await configureAgent(configurationTx, ROOT_CONVERSATION_ID, {
            tools: [],
            extensions: [],
            instructions: "Configured main fixture",
          });
        },
      ),
    context,
  );
}

test("admission denies absent and incomplete metadata and preserves original inputs on retry/reopen", async () => {
  await fixture(async (host, directory, input, expected) => {
    const read = () => host.harness.commit((tx) => requireAdmission(tx, expected), context);
    await expect(read()).rejects.toThrow("Absent");
    await initialize(host, input);
    await expect(read()).rejects.toThrow("Incomplete");
    await configure(host);
    await initialize(host, input);

    for (const changed of [
      { ...input, deadline: 999999 },
      { ...input, admittedAt: 2000 },
      { ...input, contextFingerprint: environmentHash },
      { ...input, sourceFingerprint: environmentHash },
      { ...input, profile: createRoleProfile({ ...input.profile, contextLimitBytes: 2000 }) },
    ])
      await expect(initialize(host, changed)).rejects.toThrow("immutable");
    expect(await read()).toMatchObject({
      admittedAt: 1000,
      deadline: 601000,
      configuration: { environmentFingerprint: environmentHash },
    });
    await host.close(context);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(directory, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toBeUndefined();
      const record = await reopened.harness.commit((tx) => requireAdmission(tx, expected), context);
      expect(record).toMatchObject({ admittedAt: 1000, deadline: 601000 });
      const before = await reopened.harness.inspect(context);
      await inspectAdmission(reopened, ROOT_CONVERSATION_ID, context);
      expect(await reopened.harness.inspect(context)).toEqual(before);
    } finally {
      await reopened.close(context);
    }
  });
});

test("admission denies mismatched provider, source, task and profile expectations", async () => {
  await fixture(async (host, _directory, input, expected) => {
    await initialize(host, input);
    await configure(host);

    for (const mismatch of [
      { providerSessionId: "unknown" },
      { sourceFingerprint: environmentHash },
      { taskId: "another-task" },
      { profileFingerprint: environmentHash },
    ])
      await expect(
        host.harness.commit((tx) => requireAdmission(tx, { ...expected, ...mismatch }), context),
      ).rejects.toThrow();
  });
});

test("admission configuration and its SDK changes roll back together", async () => {
  await fixture(async (host, _directory, input, expected) => {
    await initialize(host, input);
    await expect(
      host.harness.commit(
        (tx) =>
          configureAdmission(
            tx,
            host.taskId,
            ROOT_CONVERSATION_ID,
            environmentHash,
            async (configurationTx) => {
              await configureAgent(configurationTx, ROOT_CONVERSATION_ID, {
                tools: [],
                extensions: [],
                instructions: "Rolled-back main fixture",
              });
              throw new Error("configuration failed");
            },
          ),
        context,
      ),
    ).rejects.toThrow("configuration failed");
    expect(
      (await host.harness.snapshot(AgentDoc, ROOT_CONVERSATION_ID, context))?.instructions,
    ).toBeUndefined();
    expect(
      (await inspectAdmission(host, ROOT_CONVERSATION_ID, context))?.record?.configuration,
    ).toBeNull();
    await expect(
      host.harness.commit((tx) => requireAdmission(tx, expected), context),
    ).rejects.toThrow("Incomplete");
  });
});

test("admission forks start empty and unknown/unassigned conversations cannot inherit authority", async () => {
  await fixture(async (host, _directory, input) => {
    await initialize(host, input);
    await configure(host);
    const root = await host.harness.conversation(ROOT_CONVERSATION_ID, context);

    if (!root) throw new Error("Missing root");

    const entry = await host.harness.commit(
      (tx) => tx.appendEntry(ROOT_CONVERSATION_ID, { kind: "kstack.admission-test-fork" }),
      context,
    );

    const child = await root.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
    expect((await inspectAdmission(host, child.id, context))?.record ?? null).toBeNull();
    await expect(
      host.harness.commit(
        (tx) => initializeAdmission(tx, host.taskId, child.id, input, authority),
        context,
      ),
    ).rejects.toThrow("unassigned");
  });
});

test("admission denies pending local and workspace effects", async () => {
  await fixture(async (host, _directory, input, expected) => {
    await initialize(host, input);
    await configure(host);
    await host.harness.commit(async (tx) => {
      const document = await tx.doc(AdmissionDoc, ROOT_CONVERSATION_ID);

      if (!document.record) throw new Error("Missing admission");
      document.record.pendingEffectIds.push("unsafe-write");
    }, context);
    await expect(
      host.harness.commit((tx) => requireAdmission(tx, expected), context),
    ).rejects.toThrow("pending effect");
    await host.harness.commit(async (tx) => {
      (await tx.doc(WorkspacesDoc)).effects.push({
        id: "unsafe-workspace",
        operation: "admit",
        assignmentIds: [],
        status: "intent",
        authority,
        evidence: null,
      });
    }, context);
    await expect(
      host.harness.commit((tx) => requireAdmission(tx, expected), context),
    ).rejects.toThrow("pending workspace effect");
  });
});

test("admission uses real T4 assignments and rejects copied task admission", async () => {
  await fixture(async (host, directory, input, expected) => {
    const repository = await inspectGit(input.profile.cwd);
    const worktree = join(directory, "writer");
    await host.workspaces.admit(
      repository,
      [
        {
          kind: "create",
          id: "writer",
          worktree,
          branch: "feature/writer",
          base: repository.head,
          writePaths: ["file.txt"],
          contextHashes: [],
        },
      ],
      authority,
      context,
    );

    const child = await host.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );

    await host.harness.commit(async (tx) => {
      const identity = await tx.doc(ConversationIdentityDoc, child.id);
      identity.role = "writer";
      identity.assignmentId = "writer";
      await initializeAdmission(
        tx,
        host.taskId,
        child.id,
        {
          ...input,
          profile: createRoleProfile({
            role: "writer",
            cwd: worktree,
            writePaths: ["file.txt"],
            checkIds: [],
            contextLimitBytes: 1000,
          }),
        },
        authority,
      );
    }, context);
    expect((await inspectAdmission(host, child.id, context))?.record?.assignmentId).toBe("writer");
    await initialize(host, input);
    await configure(host);
    await host.harness.commit(async (tx) => {
      const document = await tx.doc(AdmissionDoc, ROOT_CONVERSATION_ID);

      if (!document.record) throw new Error("Missing admission");
      document.record.taskId = "copied-task";
    }, context);
    await expect(
      host.harness.commit((tx) => requireAdmission(tx, expected), context),
    ).rejects.toThrow("mismatch");
  });
});

test("copying another real task's admission document cannot confer admission", async () => {
  await fixture(async (host, directory, input) => {
    await initialize(host, input);
    await configure(host);
    const original = (await inspectAdmission(host, ROOT_CONVERSATION_ID, context))?.record;

    if (!original) throw new Error("Missing admission");

    const other = await DurableTaskHost.start(
      {
        repositoryRoot: input.profile.cwd,
        stateDir: join(directory, "other-state"),
        models: createModels(),
      },
      context,
    );

    try {
      const view = await other.inspect(context);

      const identity = view.identities.find(
        (entry) => entry.conversationId === ROOT_CONVERSATION_ID,
      );

      if (!identity) throw new Error("Missing second task identity");
      await other.harness.commit(async (tx) => {
        (await tx.doc(AdmissionDoc, ROOT_CONVERSATION_ID)).record = {
          ...original,
          profile: {
            ...original.profile,
            writePaths: [...original.profile.writePaths],
            checkIds: [...original.profile.checkIds],
          },
          configuration: original.configuration ? { ...original.configuration } : null,
          pendingEffectIds: [...original.pendingEffectIds],
        };
      }, context);
      await expect(
        other.harness.commit(
          (tx) =>
            requireAdmission(tx, {
              taskId: other.taskId,
              conversationId: ROOT_CONVERSATION_ID,
              providerSessionId: identity.providerSessionId,
              profileFingerprint: original.profileFingerprint,
              contextFingerprint: hash,
              sourceFingerprint: hash,
            }),
          context,
        ),
      ).rejects.toThrow("mismatch");
    } finally {
      await other.close(context);
    }
  });
});

test("worker admission rejects a nonexistent assignment rather than role metadata alone", async () => {
  await fixture(async (host, _directory, input) => {
    const child = await host.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );

    await host.harness.commit(async (tx) => {
      const identity = await tx.doc(ConversationIdentityDoc, child.id);
      identity.role = "writer";
      identity.assignmentId = "missing";
    }, context);
    await expect(
      host.harness.commit(
        (tx) => initializeAdmission(tx, host.taskId, child.id, input, authority),
        context,
      ),
    ).rejects.toThrow("owned admitted assignment");
  });
});

test("initialized workspace state with null repository and a retained effect still blocks reopen", async () => {
  await fixture(async (host, directory) => {
    await host.harness.commit(async (tx) => {
      (await tx.doc(WorkspacesDoc)).effects.push({
        id: "retained",
        operation: "admit",
        assignmentIds: [],
        status: "observed",
        authority,
        evidence: "fixture",
      });
    }, context);
    await host.close(context);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(directory, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toBe("Workspace repository binding is missing");
    } finally {
      await reopened.close(context);
    }
  });
});

test("initialized workspace state with null repository and a real assignment still blocks reopen", async () => {
  await fixture(async (host, directory, input) => {
    const repository = await inspectGit(input.profile.cwd);
    await host.workspaces.admit(
      repository,
      [
        {
          kind: "create",
          id: "retained-writer",
          worktree: join(directory, "retained-writer"),
          branch: "feature/retained-writer",
          base: repository.head,
          writePaths: ["file.txt"],
          contextHashes: [],
        },
      ],
      authority,
      context,
    );
    await host.harness.commit(async (tx) => {
      (await tx.doc(WorkspacesDoc)).repository = null;
    }, context);
    await host.close(context);

    const reopened = await DurableTaskHost.reopen(
      { taskId: host.taskId, stateDir: join(directory, "state"), models: createModels() },
      context,
    );

    try {
      expect(reopened.workspaces.blockedReason).toBe("Workspace repository binding is missing");
    } finally {
      await reopened.close(context);
    }
  });
});

async function workerFixture(
  check: (host: DurableTaskHost, input: AdmissionInputs) => Promise<void>,
) {
  await fixture(async (host, directory, input) => {
    const repository = await inspectGit(input.profile.cwd);
    const worktree = join(directory, "atomic-writer");
    await host.workspaces.admit(
      repository,
      [
        {
          kind: "create",
          id: "atomic-writer",
          worktree,
          branch: "feature/atomic-writer",
          base: repository.head,
          writePaths: ["file.txt"],
          contextHashes: [],
        },
      ],
      authority,
      context,
    );

    const workerInput: AdmissionInputs = {
      ...input,
      profile: createRoleProfile({
        role: "writer",
        cwd: worktree,
        writePaths: ["file.txt"],
        checkIds: [],
        contextLimitBytes: 1000,
      }),
    };

    await check(host, workerInput);
  });
}

async function configureWorker(tx: Tx, conversationId: ConversationId, cwd: string) {
  await configureAgent(tx, conversationId, {
    cwd,
    tools: [],
    extensions: [],
    instructions: "Atomic worker fixture",
  });
}

test("an assignment admits only one writer and preserves exact initialization retries", async () => {
  await workerFixture(async (host, input) => {
    const anchor = await host.harness.commit(async (tx) => {
      await configureAgent(tx, ROOT_CONVERSATION_ID, { tools: [], extensions: [] });

      return tx.createTask(AdmissionAnchor, null, {
        ownership: { kind: "conversation" },
        conversationId: ROOT_CONVERSATION_ID,
        background: true,
      });
    }, context);

    const create = () =>
      createAdmittedConversation(
        host,
        {
          ownership: { kind: "task", taskId: anchor },
          assignmentId: "atomic-writer",
          input,
          authority,
          environmentFingerprint: environmentHash,
          configure: (tx, admission) =>
            configureWorker(tx, admission.conversationId, admission.profile.cwd),
        },
        context,
      );

    const first = await create();
    const original = await host.harness.snapshot(AdmissionDoc, first.id, context);
    const before = await host.harness.commit((tx) => tx.scanConversations({}, 64), context);

    await expect(create()).rejects.toThrow("Conflicting writer assignment");
    const after = await host.harness.commit((tx) => tx.scanConversations({}, 64), context);
    expect(after.items).toEqual(before.items);
    expect(await host.harness.snapshot(AdmissionDoc, first.id, context)).toEqual(original);

    await host.harness.commit(
      (tx) => initializeAdmission(tx, host.taskId, first.id, input, authority),
      context,
    );
    expect(await host.harness.snapshot(AdmissionDoc, first.id, context)).toEqual(original);

    const reviewer = await createAdmittedConversation(
      host,
      {
        ownership: { kind: "task", taskId: anchor },
        assignmentId: "atomic-writer",
        input: {
          ...input,
          profile: createRoleProfile({
            role: "reviewer",
            cwd: input.profile.cwd,
            writePaths: [],
            checkIds: [],
            contextLimitBytes: 1000,
          }),
        },
        authority,
        environmentFingerprint: environmentHash,
        configure: (tx, admission) =>
          configureWorker(tx, admission.conversationId, admission.profile.cwd),
      },
      context,
    );

    expect(reviewer.id).not.toBe(first.id);
    const provider = await host.harness.snapshot(ProviderDoc, first.id, context);

    if (!provider) throw new Error("Missing original provider identity");
    expect(
      await host.harness.commit(
        (tx) =>
          requireAdmission(tx, {
            taskId: host.taskId,
            conversationId: first.id,
            providerSessionId: provider.sessionId,
            profileFingerprint: admissionProfileFingerprint(input.profile),
            contextFingerprint: hash,
            sourceFingerprint: hash,
          }),
        context,
      ),
    ).toMatchObject({ assignmentId: "atomic-writer" });
  });
});

test("worker creation binds identity, admission and real SDK agent configuration in one transaction", async () => {
  await workerFixture(async (host, input) => {
    const anchor = await host.harness.commit(async (tx) => {
      await configureAgent(tx, ROOT_CONVERSATION_ID, {
        instructions: "Parent agent must not leak",
      });

      return tx.createTask(AdmissionAnchor, null, {
        ownership: { kind: "conversation" },
        conversationId: ROOT_CONVERSATION_ID,
        background: true,
      });
    }, context);

    const publications: CommitPublication[] = [];

    const unsubscribe = host.harness.subscribeCommits((publication) => {
      publications.push(publication);
    });

    const child = await createAdmittedConversation(
      host,
      {
        ownership: { kind: "task", taskId: anchor },
        assignmentId: "atomic-writer",
        input,
        authority,
        environmentFingerprint: environmentHash,
        configure: (tx, admission) =>
          configureWorker(tx, admission.conversationId, admission.profile.cwd),
      },
      context,
    ).finally(unsubscribe);

    expect(child.owner).toEqual({ conversationId: ROOT_CONVERSATION_ID, taskId: anchor });
    expect(publications).toHaveLength(1);
    expect(publications[0]?.changes.filter((change) => change.type === "conversation")).toEqual([
      { type: "conversation", value: child },
    ]);
    expect(
      publications[0]?.changes
        .filter((change) => change.type === "document")
        .map((change) => change.record.kind),
    ).toEqual(
      expect.arrayContaining([
        "pi.agent",
        "pi.provider",
        "kstack.conversation-identity",
        "kstack.admission",
      ]),
    );
    expect(await host.harness.snapshot(AgentDoc, child.id, context)).toMatchObject({
      cwd: input.profile.cwd,
      tools: [],
      extensions: [],
      instructions: "Atomic worker fixture",
    });
    const provider = await host.harness.snapshot(ProviderDoc, child.id, context);

    if (!provider) throw new Error("Missing SDK provider");
    expect(
      await host.harness.commit(
        (tx) =>
          requireAdmission(tx, {
            taskId: host.taskId,
            conversationId: child.id,
            providerSessionId: provider.sessionId,
            profileFingerprint: admissionProfileFingerprint(input.profile),
            contextFingerprint: hash,
            sourceFingerprint: hash,
          }),
        context,
      ),
    ).toMatchObject({
      assignmentId: "atomic-writer",
      configuration: { environmentFingerprint: environmentHash },
    });

    const entry = await host.harness.commit(
      (tx) => tx.appendEntry(child.id, { kind: "kstack.admission-repair-fork" }),
      context,
    );

    const handle = await host.harness.conversation(child.id, context);

    if (!handle) throw new Error("Missing created worker");
    const fork = await handle.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
    expect(
      (await host.harness.snapshot(AdmissionDoc, fork.id, context))?.record ?? null,
    ).toBeNull();
    await expect(
      host.harness.commit(
        (tx) =>
          configureAdmission(
            tx,
            host.taskId,
            fork.id,
            environmentHash,
            (configurationTx, admission) =>
              configureWorker(configurationTx, admission.conversationId, admission.profile.cwd),
          ),
        context,
      ),
    ).rejects.toThrow("unassigned");
  });
});

test("failed worker configuration rolls back conversation, identity, real agent configuration and admission receipt", async () => {
  await workerFixture(async (host, input) => {
    const before = await host.inspect(context);
    const publications: CommitPublication[] = [];

    const unsubscribe = host.harness.subscribeCommits((publication) => {
      publications.push(publication);
    });

    let createdId: ConversationId | undefined;

    try {
      await expect(
        createAdmittedConversation(
          host,
          {
            ownership: { kind: "ownerless" },
            assignmentId: "atomic-writer",
            input,
            authority,
            environmentFingerprint: environmentHash,
            configure: async (tx, admission) => {
              createdId = admission.conversationId;
              await configureWorker(tx, admission.conversationId, admission.profile.cwd);
              throw new Error("worker configuration failed");
            },
          },
          context,
        ),
      ).rejects.toThrow("worker configuration failed");
    } finally {
      unsubscribe();
    }

    expect(publications).toEqual([]);

    if (createdId === undefined)
      throw new Error("Expected configuration of actual SDK conversation");
    expect(await host.harness.conversation(createdId, context)).toBeUndefined();
    expect(await host.harness.snapshot(AgentDoc, createdId, context)).toBeUndefined();
    expect(
      await host.harness.snapshot(ConversationIdentityDoc, createdId, context),
    ).toBeUndefined();
    expect(await host.harness.snapshot(ProviderDoc, createdId, context)).toBeUndefined();
    expect(await host.harness.snapshot(AdmissionDoc, createdId, context)).toBeUndefined();
    expect((await host.inspect(context)).identities).toEqual(before.identities);
  });
});

test("atomic worker creation denies missing assignments without committing a conversation", async () => {
  await workerFixture(async (host, input) => {
    const before = (await host.inspect(context)).identities;
    await expect(
      createAdmittedConversation(
        host,
        {
          ownership: { kind: "ownerless" },
          assignmentId: "missing",
          input,
          authority,
          environmentFingerprint: environmentHash,
          configure: (tx, admission) =>
            configureWorker(tx, admission.conversationId, admission.profile.cwd),
        },
        context,
      ),
    ).rejects.toThrow("owned admitted assignment");
    expect((await host.inspect(context)).identities).toEqual(before);
  });
});

test("atomic worker creation rejects forged, conflicting, missing and copied admission identity", async () => {
  await workerFixture(async (host, input) => {
    const mainInput: AdmissionInputs = {
      ...input,
      profile: createRoleProfile({
        role: "main",
        cwd: (await host.inspect(context)).metadata.repositoryRoot,
        writePaths: [],
        checkIds: [],
        contextLimitBytes: 1000,
      }),
    };

    await initialize(host, mainInput);
    await configure(host);

    const original = (await host.harness.snapshot(AdmissionDoc, ROOT_CONVERSATION_ID, context))
      ?.record;

    const rootProvider = await host.harness.snapshot(ProviderDoc, ROOT_CONVERSATION_ID, context);

    if (!original || !rootProvider) throw new Error("Missing actual main admission/provider");
    const before = (await host.inspect(context)).identities;

    const corruptions: ((tx: Tx, id: ConversationId) => Promise<void>)[] = [
      async (tx, id) => {
        (await tx.doc(ConversationIdentityDoc, id)).providerSessionId = "forged";
      },
      async (tx, id) => {
        (await tx.doc(ProviderDoc, id)).sessionId = rootProvider.sessionId;
        (await tx.doc(ConversationIdentityDoc, id)).providerSessionId = rootProvider.sessionId;
      },
      async (tx, id) => {
        await tx.retireDoc(ConversationIdentityDoc, id);
      },
      async (tx, id) => {
        (await tx.doc(AdmissionDoc, id)).record = {
          ...original,
          profile: {
            ...original.profile,
            writePaths: [...original.profile.writePaths],
            checkIds: [...original.profile.checkIds],
          },
          configuration: original.configuration ? { ...original.configuration } : null,
          pendingEffectIds: [...original.pendingEffectIds],
        };
      },
    ];

    for (const corrupt of corruptions) {
      await expect(
        createAdmittedConversation(
          host,
          {
            ownership: { kind: "ownerless" },
            assignmentId: "atomic-writer",
            input,
            authority,
            environmentFingerprint: environmentHash,
            configure: async (tx, admission) => {
              await configureWorker(tx, admission.conversationId, admission.profile.cwd);
              await corrupt(tx, admission.conversationId);
            },
          },
          context,
        ),
      ).rejects.toThrow();
      expect((await host.inspect(context)).identities).toEqual(before);
    }
  });
});

test("equivalent admission inputs with reordered fields retry unchanged before and after reopen", async () => {
  await fixture(async (host, directory, input) => {
    await initialize(host, input);
    await configure(host);

    if (input.profile.role !== "main") throw new Error("Expected main fixture profile");

    const reordered: AdmissionInputs = {
      deadline: input.deadline,
      admittedAt: input.admittedAt,
      sourceFingerprint: input.sourceFingerprint,
      contextFingerprint: input.contextFingerprint,
      profile: {
        contextLimitBytes: input.profile.contextLimitBytes,
        checkIds: input.profile.checkIds,
        writePaths: input.profile.writePaths,
        cwd: input.profile.cwd,
        role: input.profile.role,
      },
    };

    const before = await host.harness.snapshot(AdmissionDoc, ROOT_CONVERSATION_ID, context);
    await initialize(host, reordered);
    expect(await host.harness.snapshot(AdmissionDoc, ROOT_CONVERSATION_ID, context)).toEqual(
      before,
    );
    await host.close(context);

    const reopened = await DurableTaskHost.reopen(
      {
        taskId: host.taskId,
        stateDir: join(directory, "state"),
        models: createModels(),
        extensions: [admissionExtension],
      },
      context,
    );

    try {
      await initialize(reopened, reordered);
      expect(await reopened.harness.snapshot(AdmissionDoc, ROOT_CONVERSATION_ID, context)).toEqual(
        before,
      );
      await expect(
        initialize(reopened, { ...reordered, deadline: reordered.deadline + 1 }),
      ).rejects.toThrow("immutable");
      expect(await reopened.harness.snapshot(AdmissionDoc, ROOT_CONVERSATION_ID, context)).toEqual(
        before,
      );
    } finally {
      await reopened.close(context);
    }
  });
});
