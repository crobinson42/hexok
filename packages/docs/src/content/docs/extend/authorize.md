---
title: Authorize
description: Reads static policy. Missing policy skips. Requires ctx.principal.roles.
sidebar:
  order: 1
---

The authorize interceptor reads `static policy` on the use case. Missing policy → skip. It requires `ctx.principal.roles` to include the policy or `'admin'`. Prefer `errors.FORBIDDEN()` when the use case declared it.

Register this **before** unit of work.

```ts
class Charge extends ApiUseCase {
  static readonly policy = 'ledger:charge'
  // ...
}
```

See also: [Interceptor](/runtime/interceptor/), [Request context](/runtime/request-context/).
