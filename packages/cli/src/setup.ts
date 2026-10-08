import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { doctor, type DoctorOptions } from "./doctor.js";
import { SetupError } from "./errors.js";
import { jsonRecord, readExisting } from "./configuration.js";

export type SetupOptions = DoctorOptions & {
  home: string;
  /** Explicit Stow package root, e.g. the user's chosen home package; never inferred. */
  stowSource?: string;
  mode: "plain-skills" | "runtime";
  host: "pi" | "claude";
  rawLogRetentionDays: number;
};
export type SetupProposal = {
  destination: string;
  changes: string[];
  proposedSettings: {
    mode: SetupOptions["mode"];
    host: SetupOptions["host"];
    rawLogRetentionDays: number;
    stackRepository: string;
    generalRepository: string;
  };
  diagnostics: Awaited<ReturnType<typeof doctor>>;
};

async function assertParents(root: string, destination: string): Promise<void> {
  const relative = path.relative(root, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new SetupError("Configuration escaped its root");
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new SetupError(
          "Setup refuses an unexpected directory symlink; provide its Stow source explicitly",
        );
      if (segment === "kriscard-stack" && (info.mode & 0o077) !== 0)
        throw new SetupError(
          "The existing kriscard-stack configuration directory must be private (0700); review its permissions first",
        );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
  }
}

async function writePrivate(file: string, contents: string): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Preview first; the explicit confirmation callback is the only route to filesystem mutation. */
export async function setup(
  options: SetupOptions,
  confirm: (proposal: SetupProposal) => Promise<boolean>,
): Promise<{ applied: boolean; proposal: SetupProposal }> {
  if (
    !Number.isSafeInteger(options.rawLogRetentionDays) ||
    options.rawLogRetentionDays < 1 ||
    options.rawLogRetentionDays > 3650
  )
    throw new SetupError("Raw log retention must be between 1 and 3650 days");
  if (options.mode !== "plain-skills" && options.mode !== "runtime")
    throw new SetupError("Invalid setup mode");
  if (options.host !== "pi" && options.host !== "claude")
    throw new SetupError("Invalid setup host");
  const root = await realpath(options.stowSource ?? options.home);
  const destination = path.join(
    root,
    ".config",
    "kriscard-stack",
    "config.json",
  );
  await assertParents(root, destination);
  const original = await readExisting(destination);
  const existing = jsonRecord(original);
  const current = existing.kriscardStack;
  if (
    current !== undefined &&
    (typeof current !== "object" || current === null || Array.isArray(current))
  )
    throw new SetupError(
      "Existing Kriscard Stack settings must be a JSON object",
    );
  if (current && "schemaVersion" in current && current.schemaVersion !== 1)
    throw new SetupError(
      "Existing settings use an unsupported version; upgrade the CLI before writing",
    );
  if (current && "remote" in current && current.remote !== undefined) {
    const remote = current.remote;
    if (
      typeof remote !== "object" ||
      remote === null ||
      !("enabled" in remote) ||
      remote.enabled !== false
    )
      throw new SetupError(
        "Existing remote settings require separate security verification before setup can write",
      );
  }
  const proposedSettings = {
    mode: options.mode,
    host: options.host,
    stackRepository: await realpath(options.stackRepository),
    generalRepository: await realpath(options.generalRepository),
    rawLogRetentionDays: options.rawLogRetentionDays,
  };
  const settings: Record<string, unknown> = {
    ...(current as Record<string, unknown> | undefined),
    schemaVersion: 1,
    ...proposedSettings,
  };
  const previous = (current ?? {}) as Record<string, unknown>;
  const changes = Object.keys(settings).filter(
    (key) => settings[key] !== previous[key],
  );
  const diagnostics = await doctor(options);
  const proposal: SetupProposal = {
    destination,
    changes,
    proposedSettings,
    diagnostics,
  };
  if (!diagnostics.ok) return { applied: false, proposal };
  if (
    options.mode === "runtime" &&
    diagnostics.diagnostics.find((entry) => entry.id === `tool:${options.host}`)
      ?.status !== "pass"
  )
    throw new SetupError(
      `The selected ${options.host} host is unavailable; use plain-skills mode or install it separately`,
    );
  if (changes.length === 0 || !(await confirm(proposal)))
    return { applied: false, proposal };

  // Recheck after confirmation: another process or user may have changed the destination.
  await assertParents(root, destination);
  if ((await readExisting(destination)) !== original)
    throw new SetupError(
      "Setup configuration changed during confirmation; rerun setup",
    );
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const lock = path.join(path.dirname(destination), ".setup-lock");
  await mkdir(lock, { mode: 0o700 });
  const temporary = path.join(
    path.dirname(destination),
    `.config-${randomUUID()}.tmp`,
  );
  try {
    if ((await readExisting(destination)) !== original)
      throw new SetupError("Setup configuration changed; rerun setup");
    if (original !== undefined)
      await writePrivate(`${destination}.backup-${randomUUID()}`, original);
    const contents =
      JSON.stringify({ ...existing, kriscardStack: settings }, null, 2) + "\n";
    await writePrivate(temporary, contents);
    await rename(temporary, destination);
    const directory = await open(path.dirname(destination), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
  return { applied: true, proposal };
}
