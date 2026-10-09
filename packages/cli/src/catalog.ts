import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type SkillEntry = { name: string; sha256: string };

/** Compare entire skill bundles, including routed references, scripts, and assets. */
export async function catalog(root: string): Promise<SkillEntry[]> {
  const visited = new Set<string>();
  const skills: SkillEntry[] = [];
  let inspected = 0;
  let bytesRead = 0;
  const ignored = (name: string) =>
    name === ".git" || name === "node_modules" || name === ".DS_Store";
  function count(): void {
    if (++inspected > 10_000) throw new Error("Skill catalog is too large");
  }
  async function bytes(file: string, limit: number): Promise<Buffer> {
    const info = await stat(file);
    if (!info.isFile() || info.size > limit)
      throw new Error("Invalid or oversized skill file");
    const data = await readFile(file);
    bytesRead += data.length;
    if (data.length > limit || bytesRead > 64 * 1024 * 1024)
      throw new Error("Skill catalog is too large");
    return data;
  }
  async function fingerprint(directory: string): Promise<string> {
    const bundleRoot = await realpath(directory);
    const active = new Set<string>();
    const hash = createHash("sha256");
    async function walk(location: string, relative: string): Promise<void> {
      count();
      const canonical = await realpath(location);
      const outside = path.relative(bundleRoot, canonical);
      if (
        outside === ".." ||
        outside.startsWith(`..${path.sep}`) ||
        path.isAbsolute(outside)
      )
        throw new Error("Skill bundle link escapes its directory");
      const info = await stat(location);
      if (info.isDirectory()) {
        if (active.has(canonical))
          throw new Error("Skill bundle contains a directory cycle");
        active.add(canonical);
        hash.update(JSON.stringify([relative, "directory"]));
        for (const name of (await readdir(location))
          .filter((name) => !ignored(name))
          .sort())
          await walk(
            path.join(location, name),
            relative ? `${relative}/${name}` : name,
          );
        active.delete(canonical);
      } else if (info.isFile()) {
        const data = await bytes(location, 16 * 1024 * 1024);
        hash
          .update(JSON.stringify([relative, "file", data.length]))
          .update(data);
      } else throw new Error("Skill bundle contains a non-regular file");
    }
    await walk(directory, "");
    return hash.digest("hex");
  }
  async function visit(directory: string): Promise<void> {
    count();
    const canonical = await realpath(directory);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "SKILL.md")) {
      const data = await bytes(path.join(directory, "SKILL.md"), 1024 * 1024);
      const frontmatter = data
        .toString("utf8")
        .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      const raw = frontmatter
        ?.split(/\r?\n/)
        .find((line) => line.startsWith("name:"))
        ?.slice(5)
        .trim();
      const name = raw?.replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
        throw new Error("Invalid skill frontmatter");
      skills.push({ name, sha256: await fingerprint(directory) });
      return;
    }
    for (const entry of entries) {
      if (ignored(entry.name) || entry.name.startsWith(".")) continue;
      const location = path.join(directory, entry.name);
      if ((await stat(location)).isDirectory()) await visit(location);
    }
  }
  await visit(root);
  return skills;
}
