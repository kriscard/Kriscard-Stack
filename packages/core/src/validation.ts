import * as z from "zod";

import { CoreInvariantError } from "./errors.js";

/** Parses an untrusted record and reports a bounded invariant error on failure. */
export function decodeRecord<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path.length
          ? `/${issue.path.map(String).join("/")}`
          : "/";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new CoreInvariantError("INVALID_RECORD", summary);
  }
  return result.data;
}
