import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  fauxAssistantMessage as answer,
  fauxProvider,
  fauxToolCall as call,
} from "@earendil-works/pi-ai/providers/faux";

export default function controlledRolesProvider(pi) {
  const faux = fauxProvider();
  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  faux.setResponses([
    tool("read", {
      path: fileURLToPath(
        new URL("../../../../skills/dev/kriscard-mode/SKILL.md", import.meta.url),
      ),
    }),
    tool("durable_plan", {
      task: "Read AGENTS.md and server.ts. Propose PORT configuration while preserving the default. Ask for inaccessible ticket content rather than inventing it.",
    }),
    (request) => {
      const content = JSON.stringify(request.messages);
      assert.ok(content.includes(process.cwd()), "the SDK must receive the selected cwd");
      assert.ok(!content.includes("PARENT_PRIVATE_CONTEXT"), "do not copy the parent transcript");

      return tool("read", { path: "AGENTS.md" });
    },
    (request) => {
      assert.ok(
        JSON.stringify(request.messages).includes("Project rule: preserve the default port."),
      );

      return tool("read", { path: "server.ts" });
    },
    tool("submit_plan", {
      steps: [
        "Read PORT with a default of 3000",
        "Ask the user to approve the specification before coding",
      ],
    }),
    answer("Draft returned to native Pi. Await user approval; do not implement."),
  ]);
  pi.registerProvider(faux.provider);
}
