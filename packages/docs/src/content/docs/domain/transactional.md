---
title: Transactional
description: Adapter capability. bindTo(uow) returns a port bound to that unit of work.
sidebar:
  order: 11
---

`Transactional<T>` means the adapter can bind to a [UnitOfWork](/domain/unit-of-work/). The unit-of-work interceptor calls `bindTo(uow)` so saves participate in that transaction.

```ts
class PgIncidentRepo
  implements IncidentRepository, Transactional<IncidentRepository>
{
  bindTo(uow: UnitOfWork): IncidentRepository {
    return this
  }
}
```

See also: [RequestScoped](/domain/request-scoped/), [Unit of work interceptor](/extend/unit-of-work/).
