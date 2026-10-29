import assert from "node:assert/strict";
import {
  fauxAssistantMessage as answer,
  fauxProvider,
  fauxToolCall as call,
} from "@earendil-works/pi-ai/providers/faux";

export default function controlledWorkflow(pi) {
  const faux = fauxProvider({
    models: ["parent", "planner", "coding", "reviewer"].map((id) => ({ id })),
  });

  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  const rounds = new Map();

  const respond = (request, _options, _state, model) => {
    if (model.id === "parent") {
      const user = JSON.stringify(
        request.messages.filter((message) => message.role === "user").at(-1)?.content,
      );

      const last = request.messages.filter((message) => message.role !== "system").at(-1);

      const goal = user.includes("IMPLEMENT fixture")
        ? "coding"
        : user.includes("REVIEW fixture")
          ? "reviewer"
          : "planner";

      const resume = user.includes("RESUME fixture");
      const inaccessible = user.includes("SOURCE fixture");

      if (last?.role === "user" && !resume)
        return tool("read", {
          path: inaccessible
            ? "missing-ticket.md"
            : goal === "coding"
              ? "approved-task.md"
              : "request.md",
        });

      if (
        last?.role === "user" ||
        (last?.role === "toolResult" && last.toolName === "read" && !last.isError)
      ) {
        if (resume) return tool("durable_plan", { resume: true });

        return tool(
          goal === "coding"
            ? "durable_implement"
            : goal === "reviewer"
              ? "durable_review"
              : "durable_plan",
          {
            task:
              goal === "coding"
                ? "Approved task in approved-task.md: read AGENTS.md, change only server.ts to use PORT with a default of 3000, run node --check and report evidence."
                : goal === "reviewer"
                  ? "Review server.ts against request.md. Read AGENTS.md; report findings/evidence and stop without edits."
                  : "Read AGENTS.md and request.md; propose PORT configuration preserving default 3000, with any questions. This is a draft only.",
            model: { provider: "faux", modelId: user.includes("FAIL fixture") ? "missing" : goal },
          },
        );
      }

      return answer(
        inaccessible
          ? "Ticket source unavailable. Please paste the description and acceptance criteria."
          : "Role response received in native Pi. Await the next explicit user decision.",
      );
    }

    const content = JSON.stringify(request.messages);
    assert.ok(content.includes(process.cwd()));
    assert.ok(!content.includes("PARENT_PRIVATE_CONTEXT"));
    const round = (rounds.get(model.id) ?? 0) + 1;
    rounds.set(model.id, round);
    let message;

    if (round === 1) message = tool("read", { path: "AGENTS.md" });
    else if (model.id === "planner")
      message =
        round === 2
          ? tool("read", { path: "request.md" })
          : tool("submit_plan", {
              steps: [
                "Read PORT while preserving default 3000",
                "Ask the user to approve the task before coding",
              ],
            });
    else if (model.id === "coding") {
      if (round === 2) message = tool("read", { path: "approved-task.md" });
      else if (round === 3)
        message = tool("write", {
          path: "server.ts",
          content: "app.listen(Number(process.env.PORT ?? 3000));\n",
        });
      else if (round === 4)
        message = tool("bash", {
          command: "node --check server.ts && printf 'WORKFLOW_CHECK_OK\\n'",
        });
      else {
        assert.ok(content.includes("WORKFLOW_CHECK_OK"));
        message = answer("Changed server.ts; node --check passed (WORKFLOW_CHECK_OK).");
      }
    } else {
      assert.equal(model.id, "reviewer");

      if (round === 2) message = tool("read", { path: "server.ts" });
      else {
        assert.ok(content.includes("process.env.PORT ?? 3000"));
        message = answer(
          "No findings: server.ts:1 reads PORT with fallback 3000. Syntax-check evidence supplied. No edits; real-provider quality is not assessed by this controlled model.",
        );
      }
    }

    message.usage.input = 1;
    message.usage.output = 1;
    message.usage.totalTokens = 2;

    return message;
  };

  faux.setResponses(Array.from({ length: 40 }, () => respond));
  pi.registerProvider(faux.provider);
}
