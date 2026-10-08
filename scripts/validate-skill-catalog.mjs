import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");

/** @typedef {{ name: string, path: string }} Skill */
/** @typedef {{ name: string, paths: string[] }} DuplicateSkill */

/**
 * @param {string} contents
 * @param {string} path
 */
function parseName(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error(`${path} has no YAML frontmatter`);
  }

  const nameLine = match[1]
    .split("\n")
    .find((line) => line.startsWith("name:"));
  const name = nameLine
    ?.slice("name:".length)
    .trim()
    .replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");

  if (!name) {
    throw new Error(`${path} has no skill name`);
  }
  return name;
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function findSkillFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findSkillFiles(path)));
    if (entry.isFile() && entry.name === "SKILL.md") files.push(path);
  }
  return files;
}

/**
 * @param {string} repositoryRoot
 * @returns {Promise<Skill[]>}
 */
export async function collectSkills(repositoryRoot) {
  const skillsRoot = resolve(repositoryRoot, "skills");
  const files = await findSkillFiles(skillsRoot);
  return Promise.all(
    files.map(async (path) => ({
      name: parseName(await readFile(path, "utf8"), path),
      path: relative(repositoryRoot, path),
    })),
  );
}

/**
 * @param {Skill[][]} catalogs
 * @returns {DuplicateSkill[]}
 */
export function duplicateSkills(...catalogs) {
  const owners = new Map();
  for (const catalog of catalogs) {
    for (const skill of catalog) {
      const matches = owners.get(skill.name) ?? [];
      matches.push(skill.path);
      owners.set(skill.name, matches);
    }
  }
  return [...owners]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

async function main() {
  const manifest = JSON.parse(
    await readFile(resolve(root, "config/skills-source.json"), "utf8"),
  );
  const generalRoot = resolve(
    process.env.KRISCARD_SKILLS_REPO ?? resolve(root, "../Skills"),
  );
  const generalRevision = execFileSync(
    "git",
    ["-C", generalRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();

  if (generalRevision !== manifest.revision) {
    throw new Error(
      `Skills checkout is ${generalRevision}; expected ${manifest.revision}`,
    );
  }

  const stackSkills = await collectSkills(root);
  const generalSkills = await collectSkills(generalRoot);
  const duplicates = duplicateSkills(stackSkills, generalSkills);

  console.log(`Stack skills (${stackSkills.length}):`);
  console.log(
    stackSkills.map(({ name }) => `- ${name}`).join("\n") || "- none",
  );
  console.log(`General skills (${generalSkills.length}):`);
  console.log(
    generalSkills.map(({ name }) => `- ${name}`).join("\n") || "- none",
  );

  if (duplicates.length > 0) {
    const details = duplicates
      .map(({ name, paths }) => `${name}: ${paths.join(", ")}`)
      .join("\n");
    throw new Error(`Duplicate skill names found:\n${details}`);
  }

  console.log(
    `Catalogs are compatible (${stackSkills.length + generalSkills.length} unique skills)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
