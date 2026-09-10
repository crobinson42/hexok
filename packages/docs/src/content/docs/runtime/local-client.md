---
title: Local client
description: In-process client nested by use-case key. Event handlers are omitted.
sidebar:
  order: 5
---

`app.local` is an in-process client nested by use-case `key`. `incident.close` becomes `app.local.incident.close(input)`. Event handlers are omitted.

Pass `{ ctx, signal }` as the second argument. Tests can rebind context with [`app.as(ctx)`](/testing/app-test/).

```ts
await app.local.incident.close({ id: '1' })
```

See also: [HTTP RPC](/runtime/http-rpc/), [Request context](/runtime/request-context/).
