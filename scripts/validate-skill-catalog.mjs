import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");

const modePlaybooks = new Map([
  ["feature", "Mutating"],
  ["bug-fix", "Mutating"],
  ["refactor", "Mutating"],
  ["migration", "Mutating"],
  ["investigation", "Read-only"],
  ["review", "Read-only"],
  ["release", "Mutating"],
  ["orchestration", "Mutating"],
]);

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

/** @param {string} repositoryRoot */
export async function validateModePlaybooks(repositoryRoot) {
  const modeRoot = resolve(repositoryRoot, "skills/dev/kriscard-mode");
  const router = await readFile(resolve(modeRoot, "SKILL.md"), "utf8");
  const destinations = [...router.matchAll(/\]\(([^)\r\n]+)\)/g)]
    .map(([, destination]) => destination.trim())
    .filter((destination) => destination.includes("playbooks"));
  const invalidDestinations = destinations.filter((destination) => {
    const match = destination.match(/^playbooks\/([a-z-]+)\.md$/);
    return !match || !modePlaybooks.has(match[1]);
  });
  if (invalidDestinations.length > 0) {
    throw new Error(
      `Invalid mode playbook destinations: ${invalidDestinations.join(", ")}`,
    );
  }

  const links = destinations.map((destination) =>
    destination.slice("playbooks/".length, -".md".length),
  );
  const duplicateLinks = links.filter(
    (name, index) => links.indexOf(name) !== index,
  );
  if (duplicateLinks.length > 0) {
    throw new Error(
      `Duplicate mode playbook links: ${[...new Set(duplicateLinks)].join(", ")}`,
    );
  }

  const expectedNames = [...modePlaybooks.keys()].sort();
  const linkedNames = [...links].sort();
  const playbooksRoot = resolve(modeRoot, "playbooks");
  const fileNames = (await readdir(playbooksRoot))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
  if (
    JSON.stringify(linkedNames) !== JSON.stringify(expectedNames) ||
    JSON.stringify(fileNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error(
      `Mode playbook routes and files must match: expected ${expectedNames.join(", ")}; linked ${linkedNames.join(", ")}; files ${fileNames.join(", ")}`,
    );
  }

  for (const [name, expectedClass] of modePlaybooks) {
    const contents = await readFile(
      resolve(playbooksRoot, `${name}.md`),
      "utf8",
    );
    const readWhen = contents
      .match(/^> \*\*Read this when:\*\*[ \t]*([^\r\n]*)$/m)?.[1]
      .trim();
    if (!readWhen) throw new Error(`${name}.md requires read-when guidance`);

    const sideEffectClass = contents.match(
      /^> \*\*Side-effect class:\*\*\s*(Read-only|Mutating)\.?$/m,
    )?.[1];
    if (sideEffectClass !== expectedClass) {
      throw new Error(`${name}.md must be ${expectedClass}`);
    }
  }
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

  await validateModePlaybooks(root);

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
