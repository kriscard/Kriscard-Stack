import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Only the model response is scripted; Kstack, native Pi, resource loading and HTTP are real.
test("native Pi receives complete Mode instructions before its first model request", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "kstack-startup-")));
  const agentDir = join(directory, "agent");
  const requests: { messages: { role: string; content: string }[] }[] = [];
  let child: ReturnType<typeof spawn> | undefined;

  const server = createServer(async (request, response) => {
    let text = "";

    for await (const chunk of request) text += chunk.toString();
    // SAFETY: The isolated native Pi process sends an OpenAI chat-completion request to this loopback fixture.
    requests.push(JSON.parse(text) as { messages: { role: string; content: string }[] });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "fixture complete" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });

  try {
    await mkdir(agentDir);
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

    const native = spawn(
      process.execPath,
      [
        join(root, "packages/pi-runner/dist/bin.js"),
        "run",
        "--no-extensions",
        "--no-session",
        "Explain the repository without changing files or launching workers.",
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          TMPDIR: directory,
          PI_CODING_AGENT_DIR: agentDir,
          KSTACK_PI_BIN: join(root, "packages/pi-runner/node_modules/.bin/pi"),
          KRISCARD_MODEL: "fixture:fixture",
          PI_OFFLINE: "1",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child = native;
    let stderr = "";
    let stdout = "";
    native.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    native.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    const [code] = await once(native, "exit");
    expect(code, stderr).toBe(0);
    expect(stdout).toContain("fixture complete");
    expect(requests).toHaveLength(1);
    const system = requests[0].messages.find((message) => message.role === "system")?.content;
    const modePath = join(root, "skills/dev/kriscard-mode");
    expect(system).toContain(await readFile(join(modePath, "SKILL.md"), "utf8"));
    expect(system).toContain(`Kriscard Mode directory: ${modePath}`);
    await expect(access(join(directory, ".kstack"))).rejects.toThrow();
  } finally {
    if (child?.exitCode === null) child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
