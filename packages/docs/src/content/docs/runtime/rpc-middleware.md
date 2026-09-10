---
title: RpcMiddleware
description: Per-route request/response middleware. App.use plus optional static middleware on the use case.
sidebar:
  order: 4
---

`RpcMiddleware` wraps a request/response invoke: `context`, `input`, `next`, `errors`, `path`. The path is the use-case key. It wraps `app.local` and HTTP. Register globally with `App.use`, or per use case with `static middleware`.

It is not an [Interceptor](/runtime/interceptor/). Use interceptors for ports, publish, and dispatch. Use middleware for request/response invoke concerns.

```ts
appBuilder.use(async ({ context, input, next, errors, path }) => {
  return next()
})
```

See also: [HTTP RPC](/runtime/http-rpc/).
