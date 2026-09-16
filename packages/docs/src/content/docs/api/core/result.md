---
title: Result
description: Success-or-code result returned by validate.
sidebar:
  order: 2
---

```ts
import { fail, ok, type Result } from 'hexok/core'
```

Discriminated union. `ok` / `fail` collapse the unused arm to `never`.

```ts
type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; code: E; issues?: readonly StandardSchemaV1.Issue[] }
```

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `Result<T, E>` | type | Success `{ ok: true; value }` or fail `{ ok: false; code }`. |
| `ok(value)` | function | `{ ok: true, value }`. Error arm is `never`. |
| `fail(code, issues?)` | function | `{ ok: false, code }`. Pass `issues` from a Standard Schema fail. |

```ts
const parsed = validate(schema, value)
if (!parsed.ok) return parsed
parsed.value
```

Use-case `unwrap` throws `CodedError` from a fail arm. Entity methods throw `CodedError` instead of returning `Result`.

## Related

- [validate](/hexok/api/core/schema/)
- [CodedError](/hexok/api/core/coded-error/)
- [ExternalUseCase.unwrap](/hexok/api/app/external-use-case/)
