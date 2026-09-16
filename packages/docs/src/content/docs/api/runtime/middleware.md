---
title: ApiMiddleware
description: Onion around API execute for local and HTTP. Does not run for event handlers or nested run.
sidebar:
  order: 3
---

```ts
import type { ApiMiddleware } from 'hexok/runtime'
```

Register with [`App.use`](/hexok/api/runtime/app/). Onion around **external** `execute` (`local` and HTTP). Does not run for event handlers or nested `run`.

```ts
type ApiMiddleware<Ctx = unknown> = (args: {
  context: Ctx
  input: unknown
  next: () => Promise<unknown>
  errors: { [code: string]: (data?: unknown) => never }
  path: string
  request?: Request
}) => Promise<unknown>
```

| Field | Notes |
| --- | --- |
| `context` | Request context (`ctx` on the use case). |
| `input` | Parsed API input. |
| `next` | Continue the onion. Does not accept a replacement ctx. |
| `errors` | Error factories from the use-case error map. |
| `path` | Use-case key (`incident.close`). |
| `request` | Present on HTTP `router.fetch` only. Read headers here; set ctx with `.ctxFrom`. |

```ts
const withTiming: ApiMiddleware = async ({ path, next }) => {
  const started = Date.now()
  try {
    return await next()
  } finally {
    console.log(path, Date.now() - started)
  }
}

App.from(useCases).use(withTiming)
```

## Related

- [App.use](/hexok/api/runtime/app/)
- [Interceptor](/hexok/api/runtime/interceptor/)
- [ExternalUseCase](/hexok/api/app/external-use-case/)
