---
title: CodedError
description: Thrown by entity refusals and use-case error factories.
sidebar:
  order: 1
---

```ts
import { CodedError, validationError } from 'hexok/core'
```

Error with a machine-readable `code`, optional `message`, and optional `data`.

## Constructor

```ts
new CodedError({
  code: 'NOT_FOUND',
  message: 'Incident not found',
  data: { id: '1' },
})
```

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `C extends string` | Required. Catch and switch on this. |
| `message` | `string` | Defaults to `code`. |
| `data` | `unknown` | Set only when the constructor received `data`. |

`name` is `'CodedError'`. Extends `Error`.

## validationError

```ts
function validationError(
  message: string,
  issues?: readonly StandardSchemaV1.Issue[],
): CodedError<'VALIDATION'>
```

`VALIDATION` refusal. When `issues` is passed, `data` is `{ issues }`.

```ts
throw validationError('hexok: Incident validation failed', parsed.issues)
```

## Related

- [Result](/api/core/result/)
- [ErrorMap](/api/core/errors/)
- [httpStatus](/api/runtime/http-status/)
