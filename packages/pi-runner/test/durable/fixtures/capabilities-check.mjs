import { spawn } from "node:child_process";
import { writeFileSync, writeSync, statSync } from "node:fs";

const mode = process.argv[2];

if (mode === "success") {
  writeFileSync("file.txt", "checked\n");

  const forbidden = Object.keys(process.env).filter((key) =>
    /TOKEN|SECRET|API_KEY|SSH_AUTH_SOCK|NODE_OPTIONS/i.test(key),
  );

  console.log(
    JSON.stringify({
      forbidden,
      homePrivate: (statSync(process.env.HOME).mode & 0o077) === 0,
      configIsHome: process.env.XDG_CONFIG_HOME === process.env.HOME,
      ci: process.env.CI,
    }),
  );
} else if (mode === "unexpected") {
  writeFileSync("outside.txt", "unexpected fixture write\n");
} else if (mode === "output") {
  writeSync(1, Buffer.alloc(512 * 1024 + 32, 120));
  writeSync(2, Buffer.alloc(512 * 1024 + 32, 121));
} else if (mode === "ignore") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else if (mode === "leaf") {
  process.send?.("ready");
  setInterval(() => {}, 1000);
} else if (mode === "tree" || mode === "orphan") {
  const leaf = spawn(process.execPath, [process.argv[1], "leaf"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  leaf.once("message", () => {
    writeFileSync("ready.txt", `${process.pid}\n${leaf.pid}\n`);

    if (mode === "orphan") process.exit(0);
  });
  process.on("SIGTERM", () => {
    leaf.once("exit", () => process.exit(0));
    leaf.kill("SIGTERM");
  });
} else {
  throw new Error("Unknown fixed fixture mode");
}
