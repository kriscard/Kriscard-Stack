import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const bin = join(root, "packages/pi-runner/dist/bin.js");

type Message = {
  role: string;
  content?: string | null;
  tool_calls?: { function: { name: string } }[];
};

type Reply =
  | string
  | {
      name: string;
      arguments: {
        path?: string;
        content?: string;
        command?: string;
        action?: string;
        name?: string;
        cwd?: string;
        message?: string;
      };
    };

// Only the external model is scripted. CLI, ModelRuntime, HTTP, SDK, SQLite, tools and Git are real.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kstack-durable-"));
  const cwd = join(directory, "project");
  const writer = join(directory, "writer");
  const agentDir = join(directory, "agent");
  const sessionPath = join(directory, "session.sqlite");
  await mkdir(cwd);
  await mkdir(agentDir);
  await writeFile(join(cwd, "README.md"), "Disposable test project\n");
  await writeFile(
    join(cwd, "AGENTS.md"),
    "KSTACK_PROJECT_INSTRUCTION: keep changes in the assigned worktree.\n",
  );
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd, stdio: "ignore" },
  );
  execFileSync("git", ["worktree", "add", "-b", "writer", writer], { cwd, stdio: "ignore" });

  const requests: { messages: Message[] }[] = [];
  let hold = false;
  let held = () => {};

  const waiting = new Promise<void>((done) => {
    held = done;
  });

  let writes = 0;

  function route(messages: Message[]): Reply | undefined {
    const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";

    const calls = messages
      .flatMap((message) => message.tool_calls ?? [])
      .map((call) => call.function.name);

    if (user === "writer task") {
      if (!calls.includes("write")) {
        writes++;

        return { name: "write", arguments: { path: "feature.txt", content: "working\n" } };
      }

      if (hold) {
        held();

        return;
      }

      return "Writer complete.";
    }

    if (user === "verifier task") {
      if (!calls.includes("bash"))
        return {
          name: "bash",
          arguments: { command: 'test "$(cat feature.txt)" = working && printf verified' },
        };

      return "Verified the real file in the worker worktree.";
    }

    if (user.startsWith("[worker writer result]")) {
      if (!calls.includes("subagent") || messages[messages.length - 1].role === "user") {
        return {
          name: "subagent",
          arguments: { action: "spawn", name: "verifier", cwd: writer, message: "verifier task" },
        };
      }

      return "Verification started.";
    }

    if (user.startsWith("[worker verifier result]")) return "Workflow complete.";

    const reads = calls.filter((name) => name === "read").length;

    const guidance = [
      "kriscard-mode/SKILL.md",
      "kriscard-mode/playbooks/feature.md",
      "principle-prove-real-behavior/SKILL.md",
    ];

    if (reads < guidance.length)
      return { name: "read", arguments: { path: join(root, "skills/dev", guidance[reads]) } };

    if (!calls.includes("subagent"))
      return {
        name: "subagent",
        arguments: { action: "spawn", name: "writer", cwd: writer, message: "writer task" },
      };

    return "Writer started.";
  }

  const server = createServer(async (request, response) => {
    let text = "";

    for await (const chunk of request) text += chunk.toString();
    // SAFETY: This loopback endpoint receives the SDK's OpenAI chat-completion request in this fixture.
    const body = JSON.parse(text) as { messages: Message[] };
    requests.push(body);
    const reply = route(body.messages);

    if (reply === undefined) return;
    response.writeHead(200, { "Content-Type": "text/event-stream" });

    const delta =
      reply instanceof Object
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${requests.length}`,
                type: "function",
                function: { name: reply.name, arguments: JSON.stringify(reply.arguments) },
              },
            ],
          }
        : { role: "assistant", content: reply };

    const send = (value: {
      choices: { index: number; delta: object; finish_reason: string | null }[];
    }) => response.write(`data: ${JSON.stringify(value)}\n\n`);

    send({ choices: [{ index: 0, delta, finish_reason: null }] });
    send({
      choices: [
        { index: 0, delta: {}, finish_reason: reply instanceof Object ? "tool_calls" : "stop" },
      ],
    });
    response.end("data: [DONE]\n\n");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!(address instanceof Object)) throw new Error("Missing loopback port");
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "fixture-test-key",
          models: [
            {
              id: "fixture",
              name: "Fixture",
              reasoning: false,
              input: ["text"],
              contextWindow: 32768,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "fixture",
      defaultModel: "fixture",
      defaultThinkingLevel: "off",
    }),
  );

  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    TMPDIR: directory,
    PI_CODING_AGENT_DIR: agentDir,
    KRISCARD_MODEL: "fixture/fixture",
    PI_OFFLINE: "1",
    NO_COLOR: "1",
  };

  const children: ReturnType<typeof spawn>[] = [];

  function start(prompt?: string, input = "") {
    const child = spawn(
      process.execPath,
      [bin, "--session", sessionPath, ...(prompt ? [prompt] : [])],
      { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
    );

    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(input);
    const exited = once(child, "exit").then(([code, signal]) => ({ code, signal, stdout, stderr }));

    return { child, exited };
  }

  async function identities() {
    const sessionModule = pathToFileURL(
      join(root, "packages/pi-runner/dist/durable/session.js"),
    ).href;

    const workersModule = pathToFileURL(
      join(root, "packages/pi-runner/dist/durable/workers.js"),
    ).href;

    const script = `import {openSession,context} from ${JSON.stringify(sessionModule)}; import {Workers} from ${JSON.stringify(workersModule)}; const session=await openSession({cwd:process.cwd(),sessionPath:${JSON.stringify(sessionPath)}}); try {console.log(JSON.stringify(await session.harness.snapshot(Workers,session.root.id,context)));} finally {await session.close();}`;
    // Async spawn lets the loopback HTTP server continue serving if the SDK needs it.
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd, env });
    children.push(child);
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const [code] = await once(child, "exit");

    if (code !== 0) throw new Error(errors);

    // SAFETY: The inspected production SDK document above is our worker registry, serialized by JSON.stringify.
    return JSON.parse(output) as { agents: Record<string, { conversationId: string }> };
  }

  return {
    cwd,
    writer,
    requests,
    start,
    identities,
    waiting,
    setHold(value: boolean) {
      hold = value;
    },
    get writes() {
      return writes;
    },
    async close() {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }

      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("built CLI loads the workflow, writes in a separate Git worktree and delivers verified worker results", async ({
  onTestFinished,
}) => {
  const app = await fixture();
  onTestFinished(() => app.close());

  const result = await app.start("workflow").exited;
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain("Workflow complete.");
  expect(await readFile(join(app.writer, "feature.txt"), "utf8")).toBe("working\n");
  await expect(access(join(app.cwd, "feature.txt"))).rejects.toThrow();
  expect(JSON.stringify(app.requests[0])).toContain("KSTACK_PROJECT_INSTRUCTION");
  expect(JSON.stringify(app.requests[0])).toContain("kriscard-mode");
  expect(Object.keys((await app.identities()).agents).sort()).toEqual(["verifier", "writer"]);
}, 30000);

test("SIGKILL and reopen preserve the worker identity and resume pending work without repeating the write", async ({
  onTestFinished,
}) => {
  const app = await fixture();
  onTestFinished(() => app.close());

  app.setHold(true);
  const first = app.start("workflow");
  await Promise.race([
    app.waiting,
    first.exited.then((result) => {
      throw new Error(result.stderr + result.stdout);
    }),
  ]);
  first.child.kill("SIGKILL");
  const interrupted = await first.exited;
  expect(interrupted.signal).toBe("SIGKILL");
  const before = await app.identities();
  app.setHold(false);
  const resumed = await app.start().exited;
  expect(resumed.code, resumed.stderr + resumed.stdout).toBe(0);
  expect(resumed.stdout).toContain("Workflow complete.");
  expect((await app.identities()).agents.writer.conversationId).toBe(
    before.agents.writer.conversationId,
  );
  expect(app.writes).toBe(1);
  expect(await readFile(join(app.writer, "feature.txt"), "utf8")).toBe("working\n");
}, 30000);

test("retains input piped before asynchronous session startup and EOF", async ({
  onTestFinished,
}) => {
  const app = await fixture();
  onTestFinished(() => app.close());

  const result = await app.start(undefined, "workflow\n").exited;
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain("Workflow complete.");
  expect(await readFile(join(app.writer, "feature.txt"), "utf8")).toBe("working\n");
}, 30000);

test("refuses a second live owner without dispatching another model request", async ({
  onTestFinished,
}) => {
  const app = await fixture();
  onTestFinished(() => app.close());
  app.setHold(true);
  const first = app.start("workflow");
  await Promise.race([
    app.waiting,
    first.exited.then((result) => {
      throw new Error(result.stderr + result.stdout);
    }),
  ]);
  const requests = app.requests.length;
  const second = await app.start().exited;
  expect(second.code).toBe(1);
  expect(second.stderr).toContain("another Kstack may be running");
  expect(app.requests).toHaveLength(requests);
}, 30000);
