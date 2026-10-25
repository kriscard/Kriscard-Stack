import type { PiMessagesEvent } from "@earendil-works/pi-ai/api/pi-messages";
import type { Usage } from "@earendil-works/pi-ai";

export const protocolUsage: Usage = {
  input: 12,
  output: 7,
  cacheRead: 3,
  cacheWrite: 2,
  totalTokens: 24,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const textEvents: readonly PiMessagesEvent[] = [
  { type: "start" },
  { type: "text_start", contentIndex: 0 },
  { type: "text_delta", contentIndex: 0, delta: "finite " },
  { type: "text_delta", contentIndex: 0, delta: "answer" },
  { type: "text_end", contentIndex: 0, content: "finite answer" },
  { type: "done", reason: "stop", usage: protocolUsage },
];

// These are external service tool-call identifiers, never SDK conversation identities.
export const toolEvents: readonly PiMessagesEvent[] = [
  { type: "start" },
  { type: "toolcall_start", contentIndex: 0, id: "fixture-tool-call-1", toolName: "read" },
  { type: "toolcall_delta", contentIndex: 0, delta: '{"path":' },
  { type: "toolcall_delta", contentIndex: 0, delta: '"README.md"}' },
  {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: {
      type: "toolCall",
      id: "fixture-tool-call-1",
      name: "read",
      arguments: { path: "README.md" },
    },
  },
  { type: "done", reason: "toolUse", usage: protocolUsage },
];

export const errorEvents: readonly PiMessagesEvent[] = [
  { type: "start" },
  { type: "text_start", contentIndex: 0 },
  { type: "text_delta", contentIndex: 0, delta: "partial" },
  { type: "error", reason: "error", errorMessage: "scripted stream failure", usage: protocolUsage },
];
