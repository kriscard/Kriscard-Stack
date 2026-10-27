import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DefaultResourceLoader, parseArgs, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import { buildPiArguments } from "../src/launcher.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test.each(["checkout", "bundled"])(
  "Pi selects %s workflow skills before stale installed copies and retains personal skills",
  async (source) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "kstack-skills-")));
    const agentDir = join(directory, "agent");
    const installedMode = join(agentDir, "skills/kriscard-mode/SKILL.md");
    const installedOrchestrator = join(agentDir, "skills/kstack-orchestrator/SKILL.md");
    const personal = join(agentDir, "skills/personal-fixture/SKILL.md");
    const staleMode = "---\nname: kriscard-mode\ndescription: Old installed mode\n---\nOLD MODE\n";

    const staleOrchestrator =
      "---\nname: kstack-orchestrator\ndescription: Old installed orchestrator\n---\nOLD ORCHESTRATOR\n";

    try {
      for (const path of [installedMode, installedOrchestrator, personal])
        await mkdir(dirname(path), { recursive: true });
      await writeFile(installedMode, staleMode);
      await writeFile(installedOrchestrator, staleOrchestrator);
      await writeFile(
        personal,
        "---\nname: personal-fixture\ndescription: Personal skill retained during local development\n---\nPERSONAL\n",
      );

      let skillRoot = join(root, "skills/dev");

      let nativeArguments = buildPiArguments({
        arguments: [],
        modePath: join(skillRoot, "kriscard-mode"),
      });

      if (source === "bundled") {
        const packageRoot = join(directory, "install/kstack");
        await cp(join(root, "packages/pi-runner/dist"), join(packageRoot, "dist"), {
          recursive: true,
        });
        await cp(join(root, "packages/pi-runner/package.json"), join(packageRoot, "package.json"));
        const launcher = pathToFileURL(join(packageRoot, "dist/launcher.js")).href;

        const output = execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import {buildPiArguments,resolveKriscardModePath} from ${JSON.stringify(launcher)}; console.log(JSON.stringify(buildPiArguments({arguments:[],modePath:resolveKriscardModePath()})));`,
          ],
          {
            cwd: directory,
            env: { PATH: process.env.PATH, HOME: directory, PI_CODING_AGENT_DIR: agentDir },
            encoding: "utf8",
          },
        );

        // SAFETY: The isolated launcher invocation above emits its string-array arguments.
        nativeArguments = JSON.parse(output) as string[];
        skillRoot = join(packageRoot, "dist/skills");
      }

      const args = parseArgs(nativeArguments);

      const loader = new DefaultResourceLoader({
        cwd: directory,
        agentDir,
        settingsManager: SettingsManager.inMemory(),
        additionalSkillPaths: args.skills,
        additionalExtensionPaths: args.extensions,
        appendSystemPrompt: args.appendSystemPrompt,
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });

      await loader.reload();
      const skills = loader.getSkills().skills;
      const mode = skills.find((skill) => skill.name === "kriscard-mode");
      const orchestrator = skills.find((skill) => skill.name === "kstack-orchestrator");
      expect(mode?.filePath).toBe(join(skillRoot, "kriscard-mode/SKILL.md"));
      expect(orchestrator?.filePath).toBe(join(skillRoot, "kstack-orchestrator/SKILL.md"));
      expect(skills.find((skill) => skill.name === "personal-fixture")?.filePath).toBe(personal);
      expect(args.noExtensions).not.toBe(true);
      const modeInstructions = await readFile(join(skillRoot, "kriscard-mode/SKILL.md"), "utf8");
      expect(loader.getAppendSystemPrompt()).toContain(modeInstructions);
      expect(loader.getAppendSystemPrompt().join("\n")).toContain(
        `Kriscard Mode directory: ${join(skillRoot, "kriscard-mode")}`,
      );
      expect(await readFile(installedMode, "utf8")).toBe(staleMode);
      expect(await readFile(installedOrchestrator, "utf8")).toBe(staleOrchestrator);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
