---
title: RpcMiddleware
description: Per-route HTTP/RPC middleware. App.use plus optional static middleware on the use case.
sidebar:
  order: 4
---

`RpcMiddleware` wraps an API call: `context`, `input`, `next`, `errors`, `path`. Register globally with `App.use`, or per use case with `static middleware`.

It is not an [Interceptor](/runtime/interceptor/). Use interceptors for ports, publish, and dispatch. Use middleware for HTTP/RPC-shaped concerns.

```ts
appBuilder.use(async ({ context, input, next, errors, path }) => {
  return next()
})
```

See also: [HTTP RPC](/runtime/http-rpc/).
