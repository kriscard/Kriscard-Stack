import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watch } from "node:fs";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage as answer,
  fauxProvider,
  fauxToolCall as call,
} from "@earendil-works/pi-ai/providers/faux";
import { openRole, PlanDoc, runRole } from "../dist/roles.js";

const openPlanner = (...args) => openRole("planner", ...args);

const runPlanner = runRole;

// Exercise Pi's existing RPC UI subprotocol, not a Kstack transport or a mocked confirmation.
async function nativeConversation(
  f,
  response,
  providerName = "coding-provider.mjs",
  prompts = [
    "Implement the explicitly approved bounded fixture task in approved-task.md using the coding role.",
  ],
) {
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

  const nativePi = fileURLToPath(
    new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
  );

  const provider = fileURLToPath(new URL(`./fixtures/${providerName}`, import.meta.url));

  const child = spawn(
    process.execPath,
    [
      bin,
      "--mode",
      "rpc",
      "--extension",
      provider,
      "--provider",
      "faux",
      "--model",
      "parent",
      "--session-dir",
      join(f.cwd, "native-sessions"),
    ],
    {
      cwd: f.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: f.cwd,
        PI_CODING_AGENT_DIR: join(f.cwd, "pi"),
        KSTACK_PI_BIN: nativePi,
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const events = [];
  let prompt = 0;
  let buffer = "";
  let stderr = "";
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Native confirmation timed out: " + stderr));
      }, 15000);

      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timeout);

        if (code === 0) resolve();
        else reject(new Error(`Native Pi exited ${code}: ${stderr}`));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let end;

        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);

          if (!line.startsWith("{")) continue;
          const event = JSON.parse(line);
          events.push(event);

          if (event.type === "extension_ui_request" && event.method === "confirm")
            send({ type: "extension_ui_response", id: event.id, ...response });

          if (event.type === "agent_settled") {
            prompt += 1;

            if (prompt < prompts.length) send({ type: "prompt", message: prompts[prompt] });
            else child.stdin.end();
          }
        }
      });
      send({ type: "prompt", message: prompts[0] });
    });

    return events;
  } finally {
    child.kill();
  }
}

test("native workflow plans, waits for explicit approval, implements, reviews and reopens", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.cwd, "request.md"),
    "Controlled ticket equivalent: configure PORT; preserve default 3000.\n",
  );
  await writeFile(
    join(f.cwd, "approved-task.md"),
    "User-approved bounded fixture task: change only server.ts for PORT with default 3000 and run node --check.\n",
  );

  const events = await nativeConversation(f, { confirmed: true }, "workflow-provider.mjs", [
    "PLAN fixture from request.md; return a proposal and stop before coding. PARENT_PRIVATE_CONTEXT remains here.",
    "IMPLEMENT fixture: I approve the bounded task in approved-task.md. Use the implementer.",
    "REVIEW fixture: review the resulting change without edits.",
  ]);

  const calls = events.filter(
    (event) => event.type === "tool_execution_start" && event.toolName.startsWith("durable_"),
  );

  assert.deepEqual(
    calls.map((event) => event.toolName),
    ["durable_plan", "durable_implement", "durable_review"],
  );

  const results = events.filter(
    (event) => event.type === "tool_execution_end" && event.toolName.startsWith("durable_"),
  );

  for (const result of results) {
    assert.equal(result.isError, false, JSON.stringify(result.result));
    assert.ok(result.result.usage.totalTokens > 0, "native Pi must account for SDK model turns");
  }

  assert.match(JSON.stringify(results[0].result), /Draft plan — not approved/);
  assert.match(JSON.stringify(results[1].result), /WORKFLOW_CHECK_OK/);
  assert.match(JSON.stringify(results[2].result), /No findings.*server.ts:1/);
  assert.equal(
    events.filter((event) => event.type === "extension_ui_request" && event.method === "confirm")
      .length,
    1,
  );
  assert.equal(
    await readFile(join(f.cwd, "server.ts"), "utf8"),
    "app.listen(Number(process.env.PORT ?? 3000));\n",
  );

  for (const file of ["spec.md", "plan.md", "approval.md"])
    await assert.rejects(stat(join(f.cwd, file)), { code: "ENOENT" });
  const ids = await readdir(join(f.cwd, "pi", "durable-core-roles"));
  assert.equal(ids.length, 1);
  assert.deepEqual(
    (await readdir(join(f.cwd, "pi", "durable-core-roles", ids[0])))
      .filter((file) => file.endsWith(".sqlite"))
      .sort(),
    ["implementer.sqlite", "planner.sqlite", "reviewer.sqlite"],
  );

  const session = (await readdir(join(f.cwd, "native-sessions"))).find((file) =>
    file.endsWith(".jsonl"),
  );

  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

  const nativePi = fileURLToPath(
    new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
  );

  const provider = fileURLToPath(new URL("./fixtures/workflow-provider.mjs", import.meta.url));

  const reopened = spawnSync(
    process.execPath,
    [
      bin,
      "run",
      "--mode",
      "json",
      "--extension",
      provider,
      "--provider",
      "faux",
      "--model",
      "parent",
      "--session",
      join(f.cwd, "native-sessions", session),
      "RESUME fixture planner history.",
    ],
    {
      cwd: f.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: f.cwd,
        PI_CODING_AGENT_DIR: join(f.cwd, "pi"),
        KSTACK_PI_BIN: nativePi,
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  assert.equal(reopened.status, 0, reopened.stderr);
  assert.match(reopened.stdout, /Historical planner history.*no new run/);
  assert.match(reopened.stdout, /Read PORT while preserving default 3000/);
});

test("native errors stay errors and inaccessible source is requested before delegation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "request.md"), "Controlled ticket source for a port proposal.\n");

  const events = await nativeConversation(f, { confirmed: false }, "workflow-provider.mjs", [
    "PLAN fixture",
    "FAIL fixture with an unavailable model",
    "SOURCE fixture with inaccessible ticket",
  ]);

  const roles = events.filter(
    (event) => event.type === "tool_execution_end" && event.toolName.startsWith("durable_"),
  );

  assert.equal(roles.length, 2, "missing source must not start another role");
  assert.equal(roles[0].isError, false);
  assert.equal(roles[1].isError, true, JSON.stringify(roles[1].result));
  assert.match(JSON.stringify(roles[1].result), /model unavailable/);
  assert.doesNotMatch(JSON.stringify(roles[1].result), /Draft plan/);
  assert.match(JSON.stringify(events), /Please paste the description and acceptance criteria/);
  assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
});

test("actual native confirmation gates coding, including decline and cancellation", async (t) => {
  for (const response of [{ confirmed: true }, { confirmed: false }, { cancelled: true }]) {
    const f = await fixture(t);
    await writeFile(
      join(f.cwd, "approved-task.md"),
      "Approved fixture scope: change only server.ts to use PORT with default 3000; run node --check.\n",
    );
    const events = await nativeConversation(f, response);

    const dialog = events.find(
      (event) => event.type === "extension_ui_request" && event.method === "confirm",
    );

    assert.ok(dialog);
    assert.match(dialog.message, /faux\/coding/);
    assert.ok(dialog.message.includes(f.cwd));

    const end = events.find(
      (event) => event.type === "tool_execution_end" && event.toolName === "durable_implement",
    );

    assert.ok(end);
    assert.equal(end.isError, response.confirmed !== true, JSON.stringify(end.result));
    const source = await readFile(join(f.cwd, "server.ts"), "utf8");

    if (response.confirmed) {
      assert.equal(source, "app.listen(Number(process.env.PORT ?? 3000));\n");
      assert.match(JSON.stringify(end.result), /FIXTURE_CHECK_OK/);
    } else {
      assert.equal(source, "app.listen(3000);\n");
      assert.match(JSON.stringify(end.result), /not confirmed/);
    }
  }
});

import rolesExtension from "../dist/roles-extension.js";

test("native role rejects conflicting input and unsaved/unsafe session identities before opening state", async () => {
  const tools = [];
  rolesExtension({ registerTool: (definition) => tools.push(definition), on() {} });
  const planner = tools.find((definition) => definition.name === "durable_plan");
  const implementer = tools.find((definition) => definition.name === "durable_implement");
  await assert.rejects(
    implementer.execute("test", { task: "approved edit" }, undefined, undefined, { hasUI: false }),
    /confirmation-capable UI/,
  );

  const ctx = {
    sessionManager: { getSessionId: () => "valid-id", getSessionFile: () => undefined },
  };

  const invoke = (args, context = ctx) =>
    planner.execute("test", args, undefined, undefined, context);

  await assert.rejects(invoke({}), /either a nonempty task/);
  await assert.rejects(invoke({ task: "Plan", resume: true }), /either a nonempty task/);
  await assert.rejects(
    invoke({ resume: true, model: { provider: "faux", modelId: "faux-1" } }),
    /model overrides/,
  );
  await assert.rejects(invoke({ task: "Plan" }), /saved native Pi session/);
  await assert.rejects(
    invoke(
      { task: "Plan" },
      {
        sessionManager: { getSessionId: () => "../escape", getSessionFile: () => "session.jsonl" },
      },
    ),
    /Invalid native session identity/,
  );
});

test("unsafe coding effects are not replayed when SDK work reopens", async (t) => {
  const f = await fixture(t);
  const effect = join(f.cwd, "effect.txt");
  let observed;

  const ready = new Promise((resolve) => {
    observed = resolve;
  });

  const watcher = watch(f.cwd, () => {
    readFile(effect, "utf8")
      .then((text) => {
        if (text === "x") observed();
      })
      .catch(() => {});
  });

  t.after(() => watcher.close());
  f.faux.setResponses([tool("bash", { command: "printf x >> effect.txt; sleep 30" })]);
  let role = await openRole("implementer", f.file, f.cwd, f.models, model);

  const running = runRole(
    role,
    "Approved disposable recovery probe: append x once and wait.",
  ).catch((error) => error);

  await ready;
  watcher.close();
  await role.close();
  assert.ok((await running) instanceof Error);
  f.faux.setResponses([
    (request) => {
      assert.match(JSON.stringify(request.messages), /interrupted/i);

      return answer(
        "The unsafe command was interrupted. Partial effect remains; it was not replayed.",
      );
    },
  ]);
  role = await openRole("implementer", f.file, f.cwd, f.models, model);

  try {
    assert.match(await runRole(role, undefined), /not replayed/);
    assert.equal(await readFile(effect, "utf8"), "x");
  } finally {
    await role.close();
  }
});

test("saved coding model is retained and unavailable models require explicit override", async (t) => {
  const f = await fixture(t);
  let role = await openRole("implementer", f.file, f.cwd, f.models, model);
  await role.close();
  const alternate = fauxProvider({ provider: "alternate" });
  const models = createModels();
  models.setProvider(alternate.provider);
  const explicit = { provider: "alternate", modelId: "faux-1" };
  role = await openRole("implementer", f.file, f.cwd, models, explicit);

  try {
    await assert.rejects(
      runRole(role, "Continue with saved choices."),
      /model unavailable: faux\/faux-1/,
    );
    assert.deepEqual((await role.root.agent(context)).model, model);
    alternate.setResponses([answer("Please supply the approved artifact before edits.")]);
    assert.match(
      await runRole(role, "Use the explicitly selected configured model.", undefined, explicit),
      /approved artifact/,
    );
    assert.deepEqual((await role.root.agent(context)).model, explicit);
  } finally {
    await role.close();
  }
});

test("reviewer is separate, read-only, explicitly repeatable and persistent", async (t) => {
  const f = await fixture(t);
  const faux = fauxProvider({ models: [{ id: "big" }, { id: "small" }] });
  f.models.setProvider(faux.provider);
  const big = { provider: "faux", modelId: "big" };
  const small = { provider: "faux", modelId: "small" };
  const coding = await openRole("implementer", join(f.cwd, "coding.sqlite"), f.cwd, f.models, big);
  const reviewFile = join(f.cwd, "reviewer.sqlite");
  let reviewer = await openRole("reviewer", reviewFile, f.cwd, f.models, small);

  try {
    faux.setResponses([answer("Private implementation context retained.")]);
    await runRole(coding, "IMPLEMENTER_PRIVATE_CONTEXT");
    faux.setResponses([
      (request, _options, _state, model) => {
        assert.equal(model.id, "small");
        assert.ok(!JSON.stringify(request.messages).includes("IMPLEMENTER_PRIVATE_CONTEXT"));

        return tool("read", { path: "server.ts" });
      },
      tool("write", { path: "server.ts", content: "forbidden repair" }),
      tool("bash", { command: "touch forbidden-review" }),
      answer("Finding: server.ts:1 hard-codes the port. Evidence: app.listen(3000)."),
    ]);
    assert.deepEqual(
      (await reviewer.root.agent(context)).tools.map((tool) => tool.name),
      ["read"],
    );
    assert.match(
      await runRole(reviewer, "Review the requested configurable port behavior."),
      /Finding: server.ts:1/,
    );
    assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
    await assert.rejects(stat(join(f.cwd, "forbidden-review")), { code: "ENOENT" });

    const messages = (await reviewer.root.entries({}, 30, undefined, context)).items.flatMap(
      (entry) => entry.model ?? [],
    );

    assert.equal(
      messages.filter((message) => message.role === "toolResult" && message.isError).length,
      2,
    );
    assert.equal(faux.state.callCount, 5, "a finding must not trigger an automatic second pass");
    faux.setResponses([answer("No additional findings in the explicitly requested second pass.")]);
    assert.match(
      await runRole(reviewer, "Perform one additional review pass."),
      /No additional findings/,
    );
    faux.setResponses([answer("", { stopReason: "error", errorMessage: "Review attempt failed" })]);
    await assert.rejects(
      runRole(reviewer, "Review once more."),
      /unanswered.*Review attempt failed/,
    );
    await reviewer.close();
    reviewer = await openRole("reviewer", reviewFile, f.cwd, f.models, big);
    assert.deepEqual((await reviewer.root.agent(context)).model, small);
    assert.match(await runRole(reviewer, undefined), /\[error\].*Review attempt failed/);
  } finally {
    await reviewer.close();
    await coding.close();
  }

  await assert.rejects(
    openRole("reviewer", reviewFile, join(f.cwd, "another-project"), f.models, big),
    /belongs to another project/,
  );
});

test("native Pi invokes the read-only reviewer and returns its finding", async (t) => {
  const f = await fixture(t);
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

  const nativePi = fileURLToPath(
    new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
  );

  const provider = fileURLToPath(new URL("./fixtures/review-provider.mjs", import.meta.url));

  const result = spawnSync(
    process.execPath,
    [
      bin,
      "run",
      "--mode",
      "json",
      "--extension",
      provider,
      "--provider",
      "faux",
      "--model",
      "faux-1",
      "Review server.ts without editing.",
    ],
    {
      cwd: f.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: f.cwd,
        PI_CODING_AGENT_DIR: join(f.cwd, "pi"),
        KSTACK_PI_BIN: nativePi,
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  assert.equal(result.status, 0, result.stderr);

  const events = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

  const end = events.find(
    (event) => event.type === "tool_execution_end" && event.toolName === "durable_review",
  );

  assert.ok(end);
  assert.equal(end.isError, false, JSON.stringify(end.result));
  assert.match(JSON.stringify(end.result), /server.ts:1.*hard-codes/);
  assert.equal(
    events.filter(
      (event) => event.type === "tool_execution_start" && event.toolName === "durable_review",
    ).length,
    1,
  );
  assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
});

const model = { provider: "faux", modelId: "faux-1" };

const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "ks-role-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "AGENTS.md"), "Project rule: preserve the default port.\n");
  await writeFile(join(cwd, "server.ts"), "app.listen(3000);\n");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  return { cwd, faux, models, file: join(cwd, "planner.sqlite") };
}

test("planner uses actual read-only tools, returns a draft and reopens its SDK history", async (t) => {
  const f = await fixture(t);
  f.faux.setResponses([
    tool("read", { path: "AGENTS.md" }),
    tool("read", { path: "server.ts" }),
    tool("write", { path: "server.ts", content: "unapproved" }),
    tool("bash", { command: "touch forbidden" }),
    tool("submit_plan", { steps: ["Read PORT with a default of 3000"] }),
  ]);
  let role = await openPlanner(f.file, f.cwd, f.models, model);

  try {
    assert.deepEqual(
      (await role.root.agent(context)).tools.map((x) => x.name),
      ["read", "submit_plan"],
    );
    const text = await runPlanner(role, "Inspect the project and propose a configurable port.");
    assert.match(text, /Draft plan — not approved/);
    assert.match(text, /Read PORT with a default of 3000/);
    assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
    await assert.rejects(stat(join(f.cwd, "forbidden")), { code: "ENOENT" });
    const entries = (await role.root.entries({}, 40, undefined, context)).items;

    const errors = entries
      .flatMap((entry) => entry.model ?? [])
      .filter((msg) => msg.role === "toolResult" && msg.isError);

    assert.equal(errors.length, 2, "unavailable write/shell calls must really fail inside the SDK");
    const id = role.root.id;
    await role.close();
    role = await openPlanner(f.file, f.cwd, f.models, model);
    assert.equal(role.root.id, id);
    assert.deepEqual((await role.harness.snapshot(PlanDoc, id, context)).steps, [
      "Read PORT with a default of 3000",
    ]);
    const historical = await runPlanner(role, undefined);
    assert.match(historical, /Historical planner history — no new run/);
    assert.match(historical, /Read PORT/);
    assert.equal(
      f.faux.state.callCount,
      5,
      "reading saved history must not issue another model request",
    );
    assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  } finally {
    await role.close();
  }
});

test("missing ticket input returns a question without inventing a proposal", async (t) => {
  const f = await fixture(t);
  f.faux.setResponses([
    answer("Ticket unavailable. Please paste its description and acceptance criteria."),
  ]);
  const role = await openPlanner(f.file, f.cwd, f.models, model);

  try {
    assert.match(
      await runPlanner(role, "The ticket is inaccessible; ask for its source."),
      /Please paste/,
    );
    assert.equal(await role.harness.snapshot(PlanDoc, role.root.id, context), undefined);
    assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
  } finally {
    await role.close();
  }
});

test("a current planner failure never returns an older successful draft", async (t) => {
  const f = await fixture(t);
  f.faux.setResponses([tool("submit_plan", { steps: ["Old proposal"] })]);
  const role = await openPlanner(f.file, f.cwd, f.models, model);

  try {
    await runPlanner(role, "Propose a change.");
    f.faux.setResponses([
      answer("", { stopReason: "error", errorMessage: "Controlled role failure" }),
    ]);
    await assert.rejects(
      runPlanner(role, "Reconsider the proposal."),
      /unanswered.*Controlled role failure/i,
    );
    assert.deepEqual((await role.harness.snapshot(PlanDoc, role.root.id, context)).steps, [
      "Old proposal",
    ]);
    assert.match(await runPlanner(role, undefined), /\[error\].*Controlled role failure/);
    await assert.rejects(
      runPlanner(role, "Use an unavailable model.", undefined, {
        provider: "missing",
        modelId: "missing",
      }),
      /model unavailable/,
    );
    assert.deepEqual(
      (await role.root.agent(context)).model,
      model,
      "invalid override must not replace the saved model",
    );
  } finally {
    await role.close();
  }
});

test("native-call cancellation aborts SDK work and preserves its conversation", async (t) => {
  const f = await fixture(t);
  let started;

  const ready = new Promise((resolve) => {
    started = resolve;
  });

  f.faux.setResponses([
    (_ctx, options) =>
      new Promise((resolve) => {
        started();
        options.signal.addEventListener(
          "abort",
          () => resolve(answer("", { stopReason: "aborted" })),
          { once: true },
        );
      }),
  ]);
  const role = await openPlanner(f.file, f.cwd, f.models, model);

  try {
    const controller = new AbortController();
    const running = runPlanner(role, "Inspect this project.", controller.signal);
    await ready;
    controller.abort();
    await assert.rejects(running, /cancelled/i);
    assert.equal((await role.harness.inspect(context)).submissions.length, 0);
    assert.ok((await role.root.entries({}, 10, undefined, context)).items.length > 0);
  } finally {
    await role.close();
  }
});

test("closing without cancellation resumes the original SDK submission", async (t) => {
  const f = await fixture(t);
  let started;

  const ready = new Promise((resolve) => {
    started = resolve;
  });

  f.faux.setResponses([
    (_ctx, options) =>
      new Promise((resolve) => {
        started();
        options.signal.addEventListener(
          "abort",
          () => resolve(answer("", { stopReason: "aborted" })),
          { once: true },
        );
      }),
  ]);
  let role = await openPlanner(f.file, f.cwd, f.models, model);
  const running = runPlanner(role, "Plan the configurable port.").catch((error) => error);
  await ready;
  await role.close();
  assert.ok((await running) instanceof Error);
  f.faux.setResponses([tool("submit_plan", { steps: ["Resume the original assignment"] })]);
  role = await openPlanner(f.file, f.cwd, f.models, model);

  try {
    await assert.rejects(runPlanner(role, "Do a different task."), /unfinished saved work/);
    assert.match(await runPlanner(role, undefined), /Resume the original assignment/);
    const entries = (await role.root.entries({}, 30, undefined, context)).items;
    assert.equal(entries.filter((entry) => entry.kind === "pi.user").length, 1);
  } finally {
    await role.close();
  }
});

test("Kstack invokes the planner inside actual native Pi with Kriscard Mode", async (t) => {
  const f = await fixture(t);
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

  const nativePi = fileURLToPath(
    new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
  );

  const provider = fileURLToPath(new URL("./fixtures/roles-provider.mjs", import.meta.url));

  const result = spawnSync(
    process.execPath,
    [
      bin,
      "run",
      "--mode",
      "json",
      "--extension",
      provider,
      "--provider",
      "faux",
      "--model",
      "faux-1",
      "--session-dir",
      join(f.cwd, "native-sessions"),
      "Use Kriscard Mode to plan the configurable port; stop for approval. PARENT_PRIVATE_CONTEXT stays in this conversation.",
    ],
    {
      cwd: f.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: f.cwd,
        PI_CODING_AGENT_DIR: join(f.cwd, "pi"),
        KSTACK_PI_BIN: nativePi,
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  assert.equal(result.status, 0, result.stderr + result.stdout);

  const events = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

  const end = events.find(
    (event) => event.type === "tool_execution_end" && event.toolName === "durable_plan",
  );

  assert.ok(end, "real native Pi must execute the registered role tool");
  assert.equal(end.isError, false, JSON.stringify(end.result));
  assert.match(
    end.result.content.map((part) => part.text ?? "").join(""),
    /Draft plan — not approved/,
  );
  assert.equal(await readFile(join(f.cwd, "server.ts"), "utf8"), "app.listen(3000);\n");
  assert.equal(
    (await readdir(join(f.cwd, "native-sessions"))).filter((file) => file.endsWith(".jsonl"))
      .length,
    1,
  );
  assert.equal((await readdir(join(f.cwd, "pi", "durable-core-roles"))).length, 1);
});
