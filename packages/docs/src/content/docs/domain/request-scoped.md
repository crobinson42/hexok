---
title: RequestScoped
description: Adapter capability. fork() returns a per-call instance so two local calls do not share state.
sidebar:
  order: 12
---

`RequestScoped<T>` means the adapter can `fork()` a per-call instance. The request-scope interceptor forks so two `local` calls do not share forked state (ids, request-bound clients, and so on).

```ts
interface RequestScoped<T = unknown> {
  fork(): T
}
```

See also: [Transactional](/domain/transactional/), [Request scope interceptor](/extend/request-scope/).
