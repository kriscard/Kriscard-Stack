# TypeScript and Zod safety rules

`@kriscard/core` is the trust boundary for persisted workflow records and host-neutral contracts. Its types must describe runtime-validated values rather than values asserted to be valid.

## TypeScript rules

1. Keep `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` enabled.
2. Do not use `as unknown as`, `as any`, `@ts-ignore`, or unchecked narrowing assertions in production code.
3. Prefer control-flow narrowing, discriminated unions, explicit guards, and exhaustive `never` checks.
4. Use `satisfies` to check registries and configuration objects without widening their inferred types.
5. Treat indexed array and record access as potentially absent. Check the value instead of adding a non-null assertion.
6. Keep generic schema parameters as `Schema extends z.ZodType` so callers retain the concrete schema type.
7. Derive domain types from their schemas with `z.output<typeof Schema>` instead of maintaining parallel interfaces.
8. A narrow assertion is allowed only when an external API makes a fact impossible to express and an adjacent runtime check proves it. Document that exception. Double assertions are prohibited.

TypeScript removes assertions during compilation and performs no runtime check. The `satisfies` operator instead checks compatibility while preserving the expression's specific inferred type.

## Zod rules

1. Parse every untrusted boundary from `unknown` with `.parse()` or `.safeParse()`.
2. Obtain branded values by parsing with the branded schema. Do not manufacture brands with assertions.
3. Use `z.looseObject()` for persisted versioned records because unknown additive fields must survive read-and-rewrite cycles.
4. Use `z.strictObject()` for closed command inputs when unknown keys indicate caller error. Do not rely on plain `z.object()`, which strips unknown keys.
5. Use discriminated unions when one field selects a record variant. The discriminator must align IDs, states, and other variant-specific fields.
6. Use `.refine()` for one custom issue and `.superRefine()` only when validation may emit multiple issues or issue-specific paths.
7. Keep persisted and protocol schemas free of transforms and codecs. Their behavior cannot be represented soundly by generated JSON Schema.
8. Pair runtime-only refinements with explicit JSON Schema metadata or overrides only when the JSON Schema constraint has identical semantics. Test both representations together.
9. Generate protocol schemas with `z.toJSONSchema()` from an explicit, `satisfies`-checked registry. Do not cast a dynamic `Object.fromEntries()` result into the desired type.
10. Use `.safeParse()` where callers need bounded error details. Use `.validate()` only for boolean-only hot paths.
11. Do not enable `z.compile()` until profiling identifies a hot validation path. Compilation is an optimization and cannot define semantics.
12. Pin Zod exactly for this first release and review release notes before upgrades.

## Package review checklist

- No double assertions, explicit `any`, ignored diagnostics, or unjustified non-null assertions.
- Every exported domain type is schema-derived unless it models an internal function-only contract.
- Every persisted object is loose at each nested record boundary that must preserve additive fields.
- Every branded ID constructor validates through its schema.
- Every discriminated union rejects cross-variant combinations.
- Runtime refinements and generated JSON Schema constraints have matching tests.
- Schema parse failures report bounded paths and messages without leaking full input values.
- Node 20 and the development Node version discover and pass the same test suite.

## Primary sources

- [TypeScript: Type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)
- [TypeScript: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript: `satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
- [TypeScript: `strict`](https://www.typescriptlang.org/tsconfig/strict.html)
- [TypeScript: `noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [TypeScript: `exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
- [Zod 4 API](https://zod.dev/api)
- [Zod 4.5 release](https://zod.dev/blog/zod-4-5)
- [Zod 4.6 release](https://zod.dev/blog/zod-4-6)
- [Zod schema memory improvements](https://zod.dev/blog/reducing-memory-footprint)
- [Zod JSON Schema conversion](https://zod.dev/json-schema)
- [Zod guidance for library authors](https://zod.dev/library-authors)
- [Zod error customization](https://zod.dev/error-customization)
- [Zod AOT compilation](https://zod.dev/compile)
