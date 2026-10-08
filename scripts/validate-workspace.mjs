import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredDirectories = [
  "agents",
  "config",
  "packages",
  "scripts",
  "skills",
];
const requiredFiles = [
  ".github/workflows/ci.yml",
  "CLAUDE.md",
  "README.md",
  "config/skills-source.json",
  "config/skills-source.schema.json",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
];

for (const path of requiredDirectories) {
  const value = await stat(resolve(root, path));
  if (!value.isDirectory()) {
    throw new Error(`${path} must be a directory`);
  }
}

for (const path of requiredFiles) {
  await access(resolve(root, path));
}

const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
if (packageJson.packageManager !== "pnpm@10.34.4") {
  throw new Error("package.json must pin pnpm@10.34.4");
}
if (packageJson.private !== true) {
  throw new Error("The workspace root must remain private from npm publishing");
}

const skillsSource = JSON.parse(
  await readFile(resolve(root, "config/skills-source.json"), "utf8"),
);
if (skillsSource.repository !== "https://github.com/kriscard/Skills.git") {
  throw new Error("The general skill source must be kriscard/Skills");
}
if (skillsSource.installSource !== "kriscard/Skills") {
  throw new Error("The Skills CLI source must be kriscard/Skills");
}
if (!/^[0-9a-f]{40}$/.test(skillsSource.revision)) {
  throw new Error("The compatible Skills revision must be a full commit SHA");
}

console.log("Workspace structure is valid");
