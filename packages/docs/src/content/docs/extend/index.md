---
title: Extend
description: Copy-paste interceptors. They read typed fields and interfaces, never meta bags or Symbols.
sidebar:
  order: 0
---

Extension recipes live as copy-paste interceptors. They read **typed fields and interfaces**, never `meta` bags or Symbols.

First registered is **outer**. Register **authorize before unit of work** so a forbidden call never opens a transaction.

```ts
App.from(useCases)
  .intercept(new AuthorizeInterceptor())
  .intercept(new RequestScopeInterceptor())
  .intercept(new UnitOfWorkInterceptor())
```

- [Authorize](/extend/authorize/) — `static policy`
- [Request scope](/extend/request-scope/) — `fork()` per call
- [Unit of work](/extend/unit-of-work/) — `bindTo(uow)`, commit after `next()`
