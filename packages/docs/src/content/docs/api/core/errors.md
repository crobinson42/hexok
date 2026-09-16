---
title: ErrorMap
description: Declared error codes for entities and use cases.
sidebar:
  order: 3
---

```ts
import { defineErrors, type ErrorDef, type ErrorMap } from 'hexok/core'
```

Keys of an error map **are** the error-code union.

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `ErrorDef` | interface | `{ message?: string; data?: StandardSchemaV1 }` |
| `ErrorMap` | type | `Record<string, ErrorDef>` |
| `defineErrors(map)` | function | Returns `map` with keys kept as a finite union. |

`message` is the human text; factories fall back to the code when omitted. `data` is an optional payload schema for `errors.CODE(data)`.

```ts
const errors = defineErrors({
  NOT_FOUND: { message: 'Incident not found' },
  INVALID: {
    message: 'Invalid input',
    data: z.object({ field: z.string() }),
  },
})
```

Use for `static readonly errors` on [Entity](/hexok/api/domain/entity/), [ExternalUseCase](/hexok/api/app/external-use-case/), [InternalUseCase](/hexok/api/app/internal-use-case/), [EventUseCase](/hexok/api/app/event-use-case/), and [EventChannel](/hexok/api/app/event-channel/).

## Related

- [CodedError](/hexok/api/core/coded-error/)
- [errorFactories](/hexok/api/app/types/)
- [ExecuteCtx.errors](/hexok/api/app/execute-ctx/)
