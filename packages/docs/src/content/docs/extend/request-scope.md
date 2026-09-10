---
title: Request scope
description: Adapter implements RequestScoped. Interceptor fork()s per call.
sidebar:
  order: 2
---

Adapters that `implements RequestScoped` are `fork()`ed per call. Two `local` calls do not share forked state.

The interceptor checks `fork` at `aroundAdapter` with `requireCapability`, then forks in `aroundUseCase`.

```ts
class RequestIds implements RequestScoped<RequestIds> {
  fork(): RequestIds {
    return new RequestIds()
  }
}
```

See also: [RequestScoped](/domain/request-scoped/).
