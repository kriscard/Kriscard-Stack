import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { catalog, type SkillEntry } from "./catalog.js";
import { jsonRecord, readExisting } from "./configuration.js";
import { SetupError } from "./errors.js";

const execute = promisify(execFile);
const commandOptions = {
  timeout: 5_000,
  maxBuffer: 16 * 1024,
} as const;

function executeReadOnlyGit(args: string[]) {
  return execute("git", ["--no-optional-locks", ...args], commandOptions);
}

export type Diagnostic = {
  id: string;
  status: "pass" | "warning" | "fail";
  message: string;
  fix?: string;
};
export type Tool =
  | "git"
  | "pnpm"
  | "npm"
  | "pi"
  | "claude"
  | "herdr"
  | "tailscale"
  | "docker"
  | "xcrun";
export type DoctorOptions = {
  stackRepository: string;
  generalRepository: string;
  /** Explicit installation roots; no dotfiles path is inferred. */
  installedSkillRoots?: readonly string[];
  configurationFile?: string;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  probeTool?: (tool: Tool) => Promise<boolean>;
  /** Remote configuration is checked from observations, never changed by doctor. */
  remote?: {
    enabled: boolean;
    binding: string;
    funnel: boolean;
    deviceApprovalVerified: boolean;
    leastPrivilegeVerified: boolean;
    strongIdentityVerified: boolean;
    applicationCredentialReference?: string;
  };
};

async function probeTool(tool: Tool): Promise<boolean> {
  try {
    if (tool === "git") await executeReadOnlyGit(["--version"]);
    else await execute(tool, ["--version"], commandOptions);
    return true;
  } catch {
    return false;
  }
}

/** Read-only diagnostics; no installs, config writes, daemon launches, or policy changes. */
export async function doctor(options: DoctorOptions): Promise<{
  ok: boolean;
  diagnostics: Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  const add = (entry: Diagnostic) => diagnostics.push(entry);
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  add(
    platform === "darwin"
      ? { id: "platform", status: "pass", message: "macOS is supported" }
      : {
          id: "platform",
          status: "fail",
          message: "The first runtime release requires macOS",
          fix: "Use plain skills here or run the runtime on macOS.",
        },
  );
  add(
    /^\d+\.\d+\.\d+/.test(nodeVersion) &&
      Number(nodeVersion.split(".")[0]) >= 24
      ? {
          id: "node",
          status: "pass",
          message: "Node meets the runtime minimum",
        }
      : {
          id: "node",
          status: "fail",
          message: "Node 24 or newer is required",
          fix: "Select an up-to-date Node 24 LTS release or newer.",
        },
  );

  const probe = options.probeTool ?? probeTool;
  const tools: Tool[] = [
    "git",
    "pnpm",
    "npm",
    "pi",
    "claude",
    "herdr",
    "tailscale",
    "docker",
    "xcrun",
  ];
  const available = new Map<Tool, boolean>(
    await Promise.all(
      tools.map(
        async (tool): Promise<[Tool, boolean]> => [tool, await probe(tool)],
      ),
    ),
  );
  for (const tool of tools) {
    const found = available.get(tool) ?? false;
    const required = tool === "git";
    add({
      id: `tool:${tool}`,
      status: found ? "pass" : required ? "fail" : "warning",
      message: found ? `${tool} is available` : `${tool} was not detected`,
      ...(!found
        ? {
            fix: required
              ? "Install Git before continuing setup."
              : `Configure ${tool} only if you need its capability; doctor does not install it.`,
          }
        : {}),
    });
  }
  if (!available.get("pnpm") && !available.get("npm"))
    add({
      id: "bootstrap",
      status: "fail",
      message: "Neither pnpm nor npm is available",
      fix: "Install one supported package manager before setup.",
    });
  if (!available.get("pi") && !available.get("claude"))
    add({
      id: "hosts",
      status: "warning",
      message: "No supported coding host was detected",
      fix: "Install Pi or Claude Code, or use plain skills without durable execution.",
    });

  const catalogs = new Map<string, SkillEntry[]>();
  try {
    const manifest: unknown = JSON.parse(
      await readFile(
        path.join(options.stackRepository, "config/skills-source.json"),
        "utf8",
      ),
    );
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("revision" in manifest) ||
      typeof manifest.revision !== "string" ||
      !/^[a-f0-9]{40}$/.test(manifest.revision) ||
      !("repository" in manifest) ||
      manifest.repository !== "https://github.com/kriscard/Skills.git"
    )
      throw new Error("Invalid compatibility manifest");
    const revision = (
      await executeReadOnlyGit([
        "-C",
        options.generalRepository,
        "rev-parse",
        "HEAD",
      ])
    ).stdout.trim();
    if (revision !== manifest.revision) {
      add({
        id: "compatibility",
        status: "fail",
        message:
          "The general Skills checkout does not match the declared revision",
        fix: `Use a separate Skills checkout at ${manifest.revision}; do not reset an unrelated checkout.`,
      });
    } else {
      const dirty = (
        await executeReadOnlyGit([
          "-C",
          options.generalRepository,
          "-c",
          "core.fsmonitor=false",
          "status",
          "--porcelain",
          "--",
          "skills",
        ])
      ).stdout.trim();
      add(
        dirty
          ? {
              id: "compatibility",
              status: "fail",
              message: "The pinned Skills checkout has modified skill files",
              fix: "Use a clean checkout of the declared compatible revision.",
            }
          : {
              id: "compatibility",
              status: "pass",
              message: "The general Skills revision matches",
            },
      );
    }
  } catch {
    add({
      id: "compatibility",
      status: "fail",
      message:
        "The compatibility manifest or general checkout cannot be verified",
      fix: "Supply the Stack root and a readable Git checkout of its declared Skills revision.",
    });
  }
  for (const [id, root] of [
    ["stack", path.join(options.stackRepository, "skills")],
    ["general", path.join(options.generalRepository, "skills")],
    ...(options.installedSkillRoots ?? []).map((root, index) => [
      `installed-${index}`,
      root,
    ]),
  ] as [string, string][]) {
    try {
      const names = await catalog(root);
      if (!names.length) throw new Error("Empty skill catalog");
      catalogs.set(id, names);
      add({
        id: `catalog:${id}`,
        status: "pass",
        message: `${id} catalog contains ${names.length} skills`,
      });
    } catch {
      add({
        id: `catalog:${id}`,
        status: "fail",
        message: `${id} catalog is missing or invalid`,
        fix: "Supply a nonempty readable skills directory with valid names, complete bundles, and intact links contained within each skill.",
      });
    }
  }
  // Source owners must be unique. Installed roots are checked independently:
  // an installation of a source skill is expected, not a second source owner.
  const sourceSkills = [
    ...(catalogs.get("stack") ?? []),
    ...(catalogs.get("general") ?? []),
  ];
  const sourceNames = sourceSkills.map((skill) => skill.name);
  const collisions = (names: string[]) => [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ];
  const duplicates = [
    ...new Set([
      ...collisions(sourceNames),
      ...[...catalogs]
        .filter(([id]) => id.startsWith("installed-"))
        .flatMap(([, skills]) => collisions(skills.map((skill) => skill.name))),
    ]),
  ];
  add(
    duplicates.length
      ? {
          id: "collisions",
          status: "fail",
          message: `Duplicate skill names: ${duplicates.join(", ")}`,
          fix: "Remove the duplicate owner or conflicting installation before setup.",
        }
      : {
          id: "collisions",
          status: "pass",
          message: "No duplicate skill names found in inspected catalogs",
        },
  );

  const expected = new Map(
    sourceSkills.map((skill) => [skill.name, skill.sha256]),
  );
  const installedOwners = new Map<string, string>();
  const installedConflicts = new Set<string>();
  for (const [id, skills] of catalogs) {
    if (!id.startsWith("installed-")) continue;
    for (const skill of skills) {
      const sourceHash = expected.get(skill.name);
      const prior = installedOwners.get(skill.name);
      if (
        (sourceHash && sourceHash !== skill.sha256) ||
        (prior && prior !== skill.sha256)
      )
        installedConflicts.add(skill.name);
      installedOwners.set(skill.name, skill.sha256);
    }
  }
  const installedCatalogsComplete =
    !!options.installedSkillRoots?.length &&
    options.installedSkillRoots.every((_, index) =>
      catalogs.has(`installed-${index}`),
    );
  add(
    installedConflicts.size
      ? {
          id: "installed-ownership",
          status: "fail",
          message: `Conflicting installed skills: ${[...installedConflicts].join(", ")}`,
          fix: "Review the conflicting installation and reinstall the matching approved source with the Skills CLI; setup will not remove it.",
        }
      : {
          id: "installed-ownership",
          status: installedCatalogsComplete ? "pass" : "fail",
          message: installedCatalogsComplete
            ? "Inspected installed skill bundles match their source owners"
            : "Installed skill directories are missing, empty, or could not be inspected",
          ...(!installedCatalogsComplete
            ? {
                fix: "Supply every skill directory used by the selected host with --installed-skills.",
              }
            : {}),
        },
  );

  const missingSources = ["stack", "general"].filter(
    (id) =>
      !(catalogs.get(id) ?? []).some(
        (skill) =>
          installedOwners.get(skill.name) === skill.sha256 &&
          !installedConflicts.has(skill.name),
      ),
  );
  add(
    missingSources.length
      ? {
          id: "installed-sources",
          status: "fail",
          message: `No matching installed skills from: ${missingSources.join(", ")}`,
          fix: "Use the Skills CLI to install selected skills from both verified checkouts, then supply every host skill directory with --installed-skills. Setup will not guess paths or install them without permission.",
        }
      : {
          id: "installed-sources",
          status: "pass",
          message:
            "Matching installed skill bundles from both sources are present",
        },
  );

  let remote = options.remote;
  if (options.configurationFile) {
    try {
      const text = await readExisting(options.configurationFile);
      if (text === undefined) {
        add({
          id: "configuration",
          status: "warning",
          message: "No setup settings have been saved",
          fix: "Preview setup, then approve its proposed settings.",
        });
      } else {
        const current = jsonRecord(text).kriscardStack;
        if (
          typeof current !== "object" ||
          current === null ||
          !("schemaVersion" in current) ||
          current.schemaVersion !== 1 ||
          !("mode" in current) ||
          (current.mode !== "runtime" && current.mode !== "plain-skills") ||
          !("host" in current) ||
          (current.host !== "pi" && current.host !== "claude") ||
          !("rawLogRetentionDays" in current) ||
          typeof current.rawLogRetentionDays !== "number" ||
          !Number.isSafeInteger(current.rawLogRetentionDays) ||
          current.rawLogRetentionDays < 1 ||
          current.rawLogRetentionDays > 3650
        )
          throw new Error("Invalid saved configuration");
        for (const [key, supplied] of [
          ["stackRepository", options.stackRepository],
          ["generalRepository", options.generalRepository],
        ] as const) {
          const saved = (current as Record<string, unknown>)[key];
          if (typeof saved !== "string" || !path.isAbsolute(saved))
            throw new SetupError(
              "Saved source paths are missing or relative; rerun setup with the intended verified checkouts",
            );
          try {
            if (
              !(await stat(saved)).isDirectory() ||
              (await realpath(saved)) !== (await realpath(supplied))
            )
              throw new Error("Different saved source");
          } catch {
            throw new SetupError(
              "Saved source paths are unavailable or differ from the verified checkouts; rerun setup with the intended sources",
            );
          }
        }
        if ("remote" in current) {
          const configured = current.remote;
          if (
            typeof configured !== "object" ||
            configured === null ||
            !("enabled" in configured) ||
            typeof configured.enabled !== "boolean"
          )
            throw new Error("Invalid remote configuration");
          remote = {
            enabled: configured.enabled,
            binding:
              "binding" in configured && typeof configured.binding === "string"
                ? configured.binding
                : "",
            funnel: !("funnel" in configured) || configured.funnel !== false,
            deviceApprovalVerified: false,
            leastPrivilegeVerified: false,
            strongIdentityVerified: false,
            ...("applicationCredentialReference" in configured &&
            typeof configured.applicationCredentialReference === "string"
              ? {
                  applicationCredentialReference:
                    configured.applicationCredentialReference,
                }
              : {}),
          };
        }
        add({
          id: "configuration",
          status: "pass",
          message: "Saved settings use the supported schema",
        });
      }
    } catch (error) {
      add({
        id: "configuration",
        status: "fail",
        message:
          error instanceof SetupError
            ? error.message
            : "Saved settings are malformed, unsupported, or unsafe to read",
        fix: "Inspect the existing config and backup; repair it or upgrade the CLI. Doctor has not changed the file.",
      });
    }
  }
  if (!remote) {
    add({
      id: "remote",
      status: "warning",
      message: "Remote access was not inspected",
      fix: "Keep remote access disabled until private-access settings and tailnet policy are separately verified.",
    });
  } else if (!remote.enabled) {
    add({
      id: "remote",
      status: "pass",
      message: "Remote access is not enabled in the supplied configuration",
    });
  } else {
    const safe =
      (remote.binding === "127.0.0.1" || remote.binding === "::1") &&
      !remote.funnel &&
      available.get("tailscale") &&
      remote.deviceApprovalVerified &&
      remote.leastPrivilegeVerified &&
      remote.strongIdentityVerified &&
      /^(?:env:[A-Z_][A-Z0-9_]*|keychain:[a-zA-Z0-9._/-]{1,256})$/.test(
        remote.applicationCredentialReference ?? "",
      );
    add(
      safe
        ? {
            id: "remote",
            status: "pass",
            message:
              "Supplied remote security observations meet the requirements",
          }
        : {
            id: "remote",
            status: "fail",
            message: "Remote access lacks required private-access evidence",
            fix: "Keep remote access disabled until loopback binding, private Serve (no Funnel), device approval, strong identity, least privilege, and an application credential reference are verified.",
          },
    );
  }
  return {
    ok: !diagnostics.some((entry) => entry.status === "fail"),
    diagnostics,
  };
}
