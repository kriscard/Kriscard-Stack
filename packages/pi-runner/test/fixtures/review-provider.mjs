import {
  fauxAssistantMessage as answer,
  fauxProvider,
  fauxToolCall as call,
} from "@earendil-works/pi-ai/providers/faux";

export default function controlledReviewProvider(pi) {
  const faux = fauxProvider();
  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  faux.setResponses([
    tool("durable_review", {
      task: "Review server.ts against the requested configurable PORT behavior. Read AGENTS.md. Report evidence and stop; do not edit.",
    }),
    tool("read", { path: "AGENTS.md" }),
    tool("read", { path: "server.ts" }),
    answer("Finding: server.ts:1 hard-codes port 3000; it does not read PORT. No files changed."),
    answer("Review returned to native Pi for the next user decision."),
  ]);
  pi.registerProvider(faux.provider);
}
