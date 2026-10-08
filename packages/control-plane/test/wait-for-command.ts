import { vi } from "vitest";

import type { CommandRecord } from "../src/runtime/commands.js";
import type { OpenControlPlane } from "../src/runtime/open.js";

export async function waitForCommand(
  runtime: Pick<OpenControlPlane, "command">,
  key: string,
  status: CommandRecord["status"],
  timeout = 3_000,
): Promise<Readonly<CommandRecord>> {
  return vi.waitUntil(
    async () => {
      const record = await runtime.command(key);
      return record?.status === status ? record : false;
    },
    { timeout, interval: 10 },
  );
}
