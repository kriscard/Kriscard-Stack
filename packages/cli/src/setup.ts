import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { doctor, type DoctorOptions } from "./doctor.js";

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
  diagnostics: Awaited<ReturnType<typeof doctor>>;
};

async function readExisting(file: string): Promise<string | undefined> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Setup configuration must be a regular file");
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

async function assertParents(root: string, destination: string): Promise<void> {
  const relative = path.relative(root, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Configuration escaped its root");
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(
          "Setup refuses an unexpected directory symlink; provide its Stow source explicitly",
        );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
  }
}

function jsonRecord(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Existing setup configuration must be a JSON object");
  return parsed as Record<string, unknown>;
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
    throw new Error("Raw log retention must be between 1 and 3650 days");
  if (options.mode !== "plain-skills" && options.mode !== "runtime")
    throw new Error("Invalid setup mode");
  if (options.host !== "pi" && options.host !== "claude")
    throw new Error("Invalid setup host");
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
    throw new Error("Existing Kriscard Stack settings must be a JSON object");
  const settings: Record<string, unknown> = {
    ...(current as Record<string, unknown> | undefined),
    schemaVersion: 1,
    mode: options.mode,
    host: options.host,
    stackRepository: await realpath(options.stackRepository),
    generalRepository: await realpath(options.generalRepository),
    rawLogRetentionDays: options.rawLogRetentionDays,
  };
  const previous = (current ?? {}) as Record<string, unknown>;
  const changes = Object.keys(settings).filter(
    (key) => settings[key] !== previous[key],
  );
  const diagnostics = await doctor(options);
  const proposal: SetupProposal = { destination, changes, diagnostics };
  if (!diagnostics.ok) return { applied: false, proposal };
  if (
    options.mode === "runtime" &&
    diagnostics.diagnostics.find((entry) => entry.id === `tool:${options.host}`)
      ?.status !== "pass"
  )
    throw new Error(
      `The selected ${options.host} host is unavailable; use plain-skills mode or install it separately`,
    );
  if (changes.length === 0 || !(await confirm(proposal)))
    return { applied: false, proposal };

  // Recheck after confirmation: another process or user may have changed the destination.
  await assertParents(root, destination);
  if ((await readExisting(destination)) !== original)
    throw new Error(
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
      throw new Error("Setup configuration changed; rerun setup");
    if (original !== undefined)
      await writeFile(`${destination}.backup-${randomUUID()}`, original, {
        mode: 0o600,
        flag: "wx",
      });
    const contents =
      JSON.stringify({ ...existing, kriscardStack: settings }, null, 2) + "\n";
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
  return { applied: true, proposal };
}
