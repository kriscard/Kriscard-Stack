import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  piAgentDirectory,
  resolveKriscardModePath,
  resolveKriscardSkillPackage,
} from "./launcher.js";

function isKstackSkillTarget(target: string, name: string): boolean {
  const root = resolve(target, "../../..");
  const packagedTarget = join(root, "dist", "skills", name);
  const manifestPath = join(root, "package.json");

  if (!existsSync(manifestPath)) {
    // Recognize dangling links left behind after an npm installation was removed.
    return (
      target === packagedTarget &&
      basename(root) === "kstack" &&
      basename(dirname(root)) === "@kriscard" &&
      basename(dirname(dirname(root))) === "node_modules"
    );
  }

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (!(manifest instanceof Object) || !("name" in manifest)) return false;

  return (
    (manifest.name === "@kriscard/kstack" && target === packagedTarget) ||
    (manifest.name === "kriscard-stack" && target === join(root, "skills", "dev", name))
  );
}

/**
 * Repoint existing Kstack skill links to the selected bundled/development skills before discovery.
 * Missing aliases are not created; custom mode paths are not managed. All conflicting paths are
 * checked before writes: real directories and links outside recognizable Kstack bundles are left
 * untouched and reported as errors. Removed npm bundles are recognized by their scoped package path.
 * Each replacement is an atomic rename, not a transaction across all links; retrying completes a
 * partial repair. Shared agents follow the most recently reconciled bundle.
 */
export function reconcileBundledSkillLinks(modePath = resolveKriscardModePath()): string[] {
  if (!resolveKriscardSkillPackage(modePath)) return [];

  const bundle = dirname(modePath);

  const directories = new Set<string>();

  for (const directory of [
    join(homedir(), ".agents", "skills"),
    join(piAgentDirectory(), "skills"),
  ]) {
    if (existsSync(directory)) directories.add(realpathSync(directory));
  }

  const repairs: Array<{ path: string; previous: string; target: string }> = [];

  for (const entry of readdirSync(bundle, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !existsSync(join(bundle, entry.name, "SKILL.md"))) continue;

    const target = realpathSync(join(bundle, entry.name));

    for (const directory of directories) {
      const path = join(directory, entry.name);
      const stats = lstatSync(path, { throwIfNoEntry: false });

      if (!stats) continue;

      if (!stats.isSymbolicLink()) {
        throw new Error(
          `Skill '${path}' is not a managed Kstack link; it was not changed. Back up and move the conflicting skill before retrying.`,
        );
      }

      const previous = readlinkSync(path);
      const previousTarget = resolve(directory, previous);
      const resolvedTarget = existsSync(path) ? realpathSync(path) : previousTarget;

      if (resolvedTarget === target) continue;

      if (
        !isKstackSkillTarget(previousTarget, entry.name) &&
        !isKstackSkillTarget(resolvedTarget, entry.name)
      ) {
        throw new Error(
          `Skill '${path}' links outside Kstack; it was not changed. Back up and move the conflicting link before retrying.`,
        );
      }

      repairs.push({ path, previous, target });
    }
  }

  const repaired: string[] = [];

  for (const repair of repairs) {
    const temporary = join(dirname(repair.path), `.kstack-skill-link-${randomUUID()}`);
    symlinkSync(repair.target, temporary, "dir");

    try {
      const stats = lstatSync(repair.path, { throwIfNoEntry: false });

      if (!stats?.isSymbolicLink() || readlinkSync(repair.path) !== repair.previous) {
        if (
          stats?.isSymbolicLink() &&
          existsSync(repair.path) &&
          realpathSync(repair.path) === repair.target
        )
          continue;

        throw new Error(`Skill '${repair.path}' changed during repair; retry the command.`);
      }

      renameSync(temporary, repair.path);
      repaired.push(repair.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  return repaired;
}
