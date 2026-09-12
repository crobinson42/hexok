---
title: Schema
description: Standard Schema V1 validate and Infer.
sidebar:
  order: 4
---

```ts
import { type Infer, type StandardSchemaV1, validate } from 'hexok/core'
```

Hexok accepts any [Standard Schema V1](https://standardschema.dev) implementation (for example Zod). `hexok/core` vendors the type so it has zero runtime dependencies.

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `StandardSchemaV1<Input, Output>` | interface | Spec bag at `~standard`. |
| `Infer<S>` | type | Output type of schema `S`. |
| `validate(schema, value)` | function | Sync only. Returns `Result<Infer<S>, 'VALIDATION'>`. |

```ts
const parsed = validate(Incident.schema, body)
if (!parsed.ok) return parsed
```

## validate

Failures are `{ ok: false, code: 'VALIDATION', issues }`. Entity `create` / `parse` / `set` / `validate()` throw that as `CodedError`. `restore` does not run the schema.

An async schema (`validate` returning a Promise) throws `Error('hexok: async schemas belong at the RPC boundary')`.

## Related

- [Result](/api/core/result/)
- [CodedError](/api/core/coded-error/)
- [Entity](/api/domain/entity/)
