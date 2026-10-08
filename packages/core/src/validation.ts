import { type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { CoreInvariantError } from "./errors.js";

export function decodeRecord<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
): Static<Schema> {
  if (!Value.Check(schema, value)) {
    const summary = [...Value.Errors(schema, value)]
      .slice(0, 3)
      .map((error) => `${error.path || "/"}: ${error.message}`)
      .join("; ");
    throw new CoreInvariantError("INVALID_RECORD", summary);
  }
  return value as Static<Schema>;
}
