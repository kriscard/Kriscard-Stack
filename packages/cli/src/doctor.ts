import { execFile } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

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
    await execute(tool, ["--version"], {
      timeout: 5_000,
      maxBuffer: 16 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function catalog(root: string): Promise<string[]> {
  const visited = new Set<string>();
  const names: string[] = [];
  async function visit(directory: string): Promise<void> {
    const canonical = await realpath(directory);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else if (entry.isFile() && entry.name === "SKILL.md") {
        const content = await readFile(location, "utf8");
        const frontmatter = content.match(
          /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
        )?.[1];
        const raw = frontmatter
          ?.split(/\r?\n/)
          .find((line) => line.startsWith("name:"))
          ?.slice(5)
          .trim();
        const name = raw?.replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");
        if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
          throw new Error("Invalid skill frontmatter");
        names.push(name);
      } else if (entry.isSymbolicLink()) {
        // Installed skill directories are commonly symlinked by the Skills CLI.
        await visit(location);
      }
    }
  }
  await visit(root);
  return names;
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

  const catalogs = new Map<string, string[]>();
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
      await execute(
        "git",
        ["-C", options.generalRepository, "rev-parse", "HEAD"],
        {
          timeout: 5_000,
          maxBuffer: 16 * 1024,
        },
      )
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
        await execute(
          "git",
          [
            "-C",
            options.generalRepository,
            "status",
            "--porcelain",
            "--",
            "skills",
          ],
          {
            timeout: 5_000,
            maxBuffer: 16 * 1024,
          },
        )
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
        fix: "Supply a readable skills directory with valid SKILL.md names and intact links.",
      });
    }
  }
  // Source owners must be unique. Installed roots are checked independently:
  // an installation of a source skill is expected, not a second source owner.
  const sourceNames = [
    ...(catalogs.get("stack") ?? []),
    ...(catalogs.get("general") ?? []),
  ];
  const collisions = (names: string[]) => [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ];
  const duplicates = [
    ...new Set([
      ...collisions(sourceNames),
      ...[...catalogs]
        .filter(([id]) => id.startsWith("installed-"))
        .flatMap(([, names]) => collisions(names)),
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

  const remote = options.remote;
  if (!remote || !remote.enabled) {
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
      !!remote.applicationCredentialReference;
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
