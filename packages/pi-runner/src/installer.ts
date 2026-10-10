import { spawn } from "node:child_process";

export const PI_AGENT = "pi";

export const KSTACK_PACKAGE = "@kriscard/kstack@latest";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export type InstalledSkill = {
  name: string;
  source?: string | null;
  agents?: string[];
};

export type SkillCandidate = {
  name: string;
  source: string;
};

export type SetupPlan = {
  candidates: SkillCandidate[];
  conflicts: Array<{
    name: string;
    candidateSource: string;
    installedSource: string;
  }>;
  herdrAvailable: boolean;
  commands: Array<{ command: string; args: string[] }>;
};

const sourceAliases = new Map([
  ["herdrdev/herdr", new Set(["herdrdev/herdr", "ogulcancelik/herdr"])],
]);

const skillSelections = [
  { source: "kriscard/Skills", skill: "*" },
  { source: "kriscard/Kriscard-Stack", skill: "*" },
  { source: "herdrdev/herdr", skill: "herdr" },
] as const;

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

function requireSuccess(result: CommandResult, description: string): CommandResult {
  if (result.code === 0) return result;
  const detail = result.stderr.trim() || result.stdout.trim();
  throw new Error(`${description} failed${detail ? `: ${detail}` : ""}`);
}

type JsonObject = { [key: string]: JsonValue };

type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];

function parseJson(value: string, description: string): JsonValue {
  try {
    // SAFETY: Successful JSON.parse calls produce only values represented by JsonValue.
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new Error(`${description} returned invalid JSON`);
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && value.constructor === Object;
}

function isJsonString(value: JsonValue | undefined): value is string {
  return value !== undefined && value !== null && value.constructor === String;
}

function isInstalledSkill(value: JsonValue): value is JsonObject & InstalledSkill {
  if (!isJsonObject(value) || !isJsonString(value.name)) return false;

  const source = value.source;

  if (source !== undefined && source !== null && !isJsonString(source)) {
    return false;
  }

  const agents = value.agents;

  return agents === undefined || (Array.isArray(agents) && agents.every(isJsonString));
}

function listedSkillNames(output: string): string[] {
  const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
  const plain = output.replace(ansiSequence, "");
  const available = plain.split("Available Skills", 2)[1];

  if (!available) throw new Error("Skills CLI list output has an unknown format");

  return available.split("\n").flatMap((line) => {
    const match = /^│ {4}([a-z0-9][a-z0-9-]*)\s*$/.exec(line);

    return match ? [match[1]] : [];
  });
}

async function probeSource(
  runner: CommandRunner,
  source: string,
  skill: string,
): Promise<SkillCandidate[]> {
  const result = requireSuccess(
    await runner("npx", ["--yes", "skills@latest", "add", source, "--list"], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    }),
    `Skill discovery for ${source}`,
  );

  const names = listedSkillNames(`${result.stdout}\n${result.stderr}`);
  const selected = skill === "*" ? names : names.filter((name) => name === skill);

  if (!selected.length) {
    throw new Error(`Skill discovery for ${source} did not find '${skill}'`);
  }

  return selected.map((name) => ({ name, source }));
}

async function readInstalledSkills(runner: CommandRunner): Promise<InstalledSkill[]> {
  const result = requireSuccess(
    await runner("npx", [
      "--yes",
      "skills@latest",
      "list",
      "--global",
      "--agent",
      PI_AGENT,
      "--json",
    ]),
    "Installed skill discovery for Pi",
  );

  const installed = parseJson(result.stdout, "Installed skill discovery");

  if (!Array.isArray(installed) || !installed.every(isInstalledSkill)) {
    throw new Error("Installed skill discovery returned an unexpected shape");
  }

  return installed;
}

function sameSource(candidate: string, installed: string): boolean {
  return candidate === installed || Boolean(sourceAliases.get(candidate)?.has(installed));
}

function installationCommands(): Array<{ command: string; args: string[] }> {
  return [
    {
      command: "npm",
      args: ["install", "--global", KSTACK_PACKAGE],
    },
    ...skillSelections.map(({ source, skill }) => ({
      command: "npx",
      args: [
        "--yes",
        "skills@latest",
        "add",
        source,
        "--skill",
        skill,
        "--agent",
        PI_AGENT,
        "--global",
        "--yes",
        "--json",
      ],
    })),
  ];
}

export async function createSetupPlan(runner: CommandRunner = runCommand): Promise<SetupPlan> {
  const candidates = (
    await Promise.all(
      skillSelections.map(({ source, skill }) => probeSource(runner, source, skill)),
    )
  ).flat();

  const candidateOwners = new Map<string, string>();

  for (const candidate of candidates) {
    const previous = candidateOwners.get(candidate.name);

    if (previous && previous !== candidate.source) {
      throw new Error(
        `Candidate skill '${candidate.name}' is owned by both ${previous} and ${candidate.source}`,
      );
    }

    candidateOwners.set(candidate.name, candidate.source);
  }

  const installed = await readInstalledSkills(runner);

  const conflicts = candidates.flatMap((candidate) => {
    const existing = installed.find((skill) => skill.name === candidate.name);

    if (!existing || (existing.source && sameSource(candidate.source, existing.source))) return [];

    return [
      {
        name: candidate.name,
        candidateSource: candidate.source,
        installedSource: existing.source ?? "unknown source",
      },
    ];
  });

  const herdrAvailable =
    (
      await runner("herdr", ["--help"]).catch(() => ({
        code: 1,
        stdout: "",
        stderr: "",
      }))
    ).code === 0;

  return {
    candidates,
    conflicts,
    herdrAvailable,
    commands: installationCommands(),
  };
}

function displayCommand(command: string, args: readonly string[]): string {
  return [command, ...args.map((argument) => JSON.stringify(argument))].join(" ");
}

export function formatSetupPlan(plan: SetupPlan, operation: string): string {
  const sources = skillSelections
    .map(({ source, skill }) => `  - ${source}: ${skill === "*" ? "all discovered skills" : skill}`)
    .join("\n");

  const conflicts = plan.conflicts.length
    ? `\nConflicts:\n${plan.conflicts
        .map(
          (conflict) =>
            `  - ${conflict.name}: ${conflict.installedSource} conflicts with ${conflict.candidateSource}`,
        )
        .join("\n")}`
    : "";

  return `${operation} preview

Global CLI:
  - npm install --global ${KSTACK_PACKAGE}

Global Pi skills (${plan.candidates.length}, Skills CLI default linking mode):
${sources}
  - target: ~/.agents/skills with Pi links managed by the Skills CLI

Commands after confirmation:
${plan.commands.map((step) => `  - ${displayCommand(step.command, step.args)}`).join("\n")}

Herdr CLI: ${plan.herdrAvailable ? "available" : "not found; ordinary Kstack will work but orchestration will be unavailable"}

Skills CLI may collect anonymous telemetry. Set DO_NOT_TRACK=1 or DISABLE_TELEMETRY=1 to disable it.${conflicts}

Unrelated installed skills will not be removed.`;
}

export async function applySetupPlan(
  plan: SetupPlan,
  runner: CommandRunner = runCommand,
  output: (value: string) => void = (value) => process.stdout.write(value),
): Promise<void> {
  if (plan.conflicts.length) {
    throw new Error("Resolve the reported skill ownership conflicts first");
  }

  for (const step of plan.commands) {
    const result = requireSuccess(
      await runner(step.command, step.args),
      `${step.command} ${step.args.join(" ")}`,
    );

    if (result.stdout.trim()) output(`${result.stdout.trim()}\n`);
  }

  for (const binary of ["kstack", "kriscard"]) {
    requireSuccess(await runner(binary, ["--help"]), `${binary} verification`);
  }

  const installed = await readInstalledSkills(runner);

  for (const candidate of plan.candidates) {
    const match = installed.find((skill) => skill.name === candidate.name);

    if (!match || !match.source || !sameSource(candidate.source, match.source)) {
      throw new Error(`Skill verification failed for ${candidate.name} from ${candidate.source}`);
    }
  }
}
