---
title: Interceptor
description: Extension seam. First registered is outer. aroundUseCase, aroundAdapter, aroundPublish, aroundDispatch.
sidebar:
  order: 3
---

An `Interceptor` is the extension seam. First registered is **outer**. Register authorize **before** unit of work so a forbidden call never opens a transaction.

Hooks: `aroundUseCase`, `aroundAdapter`, `aroundPublish`, `aroundDispatch`. Interceptors that swallow `next()` in `aroundPublish` **drop** the event.

Publish flushes after the use-case onion, so a successful unit-of-work commit naturally yields after-commit publish.

```ts
class AuthorizeInterceptor implements Interceptor {
  readonly key = 'authorize'
  aroundUseCase(uc, next) {
    return async (ctx) => {
      const policy = (uc as { policy?: string }).policy
      if (policy) check(ctx, policy)
      return next(ctx)
    }
  }
}
```

See also: [Extend](/extend/), [RpcMiddleware](/runtime/rpc-middleware/).
