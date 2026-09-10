---
title: Request context
description: "ctx types the execute ctx field. Tests can app.as({ requestId: 'test' })."
sidebar:
  order: 8
---

`.ctx<AppContext>(defaults)` types `ctx` in `execute`. Defaults apply when a call does not pass `opts.ctx`. HTTP may send `ctx` in the JSON body.

Tests rebind with `app.as({ requestId: 'test' })` without rebuilding.

```ts
.ctx<AppContext>({ requestId: 'boot' })

async execute({ ctx }: ExecuteCtx<typeof CloseIncident, AppContext>) {
  ctx.requestId
}
```

See also: [ExecuteCtx](/application/execute-ctx/), [App.test](/testing/app-test/).
