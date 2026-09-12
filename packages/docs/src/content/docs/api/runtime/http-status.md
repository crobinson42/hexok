---
title: httpStatus
description: Map a coded error to an HTTP status.
sidebar:
  order: 6
---

```ts
import { httpStatus } from 'hexok/runtime'
```

```ts
function httpStatus(code: string): number
```

| Code | Status |
| --- | --- |
| `NOT_FOUND` | 404 |
| `VALIDATION` | 400 |
| `FORBIDDEN` | 403 |
| `UNAUTHORIZED` | 401 |
| other | 409 |

```ts
httpStatus('NOT_FOUND') // 404
httpStatus('ALREADY_CLOSED') // 409
```

`router.fetch` uses this map when `execute` throws `CodedError`.

## Related

- [CodedError](/api/core/coded-error/)
- [App.router](/api/runtime/app/)
- [RPC](/api/runtime/rpc/)
