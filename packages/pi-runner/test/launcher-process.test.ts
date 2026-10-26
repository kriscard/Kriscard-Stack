import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const bin = join(root, "packages/pi-runner/dist/bin.js");

// The external Pi executable is a probe; the built Kstack CLI and process handoff are real.
test.each([
  { args: [], print: false },
  { args: ["run", "Explain the code"], print: true },
  { args: ["--continue"], print: false },
])("built launcher hands $args to native Pi without opening Durable", async ({ args, print }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "kstack-native-")));
  const executable = join(directory, "pi-probe");

  try {
    await writeFile(
      executable,
      "#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n",
    );
    await chmod(executable, 0o700);

    const output = execFileSync(process.execPath, [bin, ...args], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: directory, KSTACK_PI_BIN: executable },
    });

    // SAFETY: The executable above emits this exact probe record.
    const received = JSON.parse(output) as { args: string[]; cwd: string };
    expect(received.cwd).toBe(directory);
    expect(received.args).toContain("--skill");
    expect(received.args.includes("--print")).toBe(print);
    const instructions = received.args[received.args.indexOf("--append-system-prompt") + 1];
    expect(instructions).toContain("interactive Pi frontend");
    expect(instructions).toContain(JSON.stringify(bin));
    expect(instructions).toContain('"durable"');

    if (args.includes("--continue")) expect(received.args).toContain("--continue");

    if (print) expect(received.args).toContain("Explain the code");
    await expect(access(join(directory, ".kstack"))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
