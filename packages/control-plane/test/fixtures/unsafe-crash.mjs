import { writeFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openControlPlane } from "../../dist/runtime/open.js";

const [
  ,
  ,
  root,
  sideEffectPath,
  replayClass = "manual_recovery",
  failures = "0",
] = process.argv;
if (!root || !sideEffectPath)
  throw new Error("Expected data root and marker path");

let attempts = 0;
const runtime = await openControlPlane(root, BACKGROUND_CONTEXT, {
  classify: () => replayClass,
  async execute() {
    if (++attempts <= Number(failures)) throw new Error("known failure");
    await writeFile(sideEffectPath, "external action happened\n");
    process.stdout.write("SIDE_EFFECT_DONE\n");
    await new Promise(() => {});
    return "unreachable";
  },
});
await runtime.submit({
  key: "crash-after-effect",
  operation: "test-external-effect",
});
setInterval(() => {}, 60_000);
