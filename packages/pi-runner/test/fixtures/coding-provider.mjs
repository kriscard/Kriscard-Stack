import assert from "node:assert/strict";
import {
  fauxAssistantMessage as answer,
  fauxProvider,
  fauxToolCall as call,
} from "@earendil-works/pi-ai/providers/faux";

export default function controlledCodingProvider(pi) {
  const faux = fauxProvider({ models: [{ id: "parent" }, { id: "coding" }] });
  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  let parent = 0;
  let coding = 0;

  const respond = (request, _options, _state, model) => {
    if (model.id === "parent") {
      parent += 1;

      if (parent === 1)
        return tool("durable_implement", {
          task: "Explicitly approved fixture task: read AGENTS.md and approved-task.md. Change only server.ts to read PORT with a default of 3000. Run node --check server.ts and report actual evidence. Stop on a deviation.",
          model: { provider: "faux", modelId: "coding" },
        });

      return answer("The role returned. Native Pi retains workflow ownership.");
    }

    assert.equal(model.id, "coding");
    assert.ok(JSON.stringify(request.messages).includes(process.cwd()));
    coding += 1;

    if (coding === 1) return tool("read", { path: "AGENTS.md" });

    if (coding === 2) return tool("read", { path: "approved-task.md" });

    if (coding === 3)
      return tool("write", {
        path: "server.ts",
        content: "app.listen(Number(process.env.PORT ?? 3000));\n",
      });

    if (coding === 4)
      return tool("bash", { command: "node --check server.ts && printf 'FIXTURE_CHECK_OK\\n'" });
    assert.ok(
      JSON.stringify(request.messages).includes("FIXTURE_CHECK_OK"),
      "report only an executed check",
    );

    return answer(
      "Changed only server.ts. node --check server.ts passed (FIXTURE_CHECK_OK). No deviation.",
    );
  };

  faux.setResponses(Array.from({ length: 15 }, () => respond));
  pi.registerProvider(faux.provider);
}
