---
title: Capabilities
description: Optional adapter capability interfaces intersected with a port.
sidebar:
  order: 7
---

```ts
import type {
  CrudRepository,
  RequestScoped,
  Transactional,
  UnitOfWork,
} from 'hexok/domain'
```

Pass `{ transactional: true }` / `{ requestScoped: true }` to [`Port.token`](/api/domain/port/) so `provide()` throws if the impl is missing `bindTo` / `fork`.

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `UnitOfWork` | interface | `onCommit(fn)`, `onRollback(fn)` |
| `Transactional<T>` | interface | `bindTo(uow: UnitOfWork): T` |
| `RequestScoped<T>` | interface | `fork(): T` |
| `CrudRepository<E>` | interface | `get`, `save`, optional `list` / `delete` |

```ts
class PgIncidentRepo
  implements IncidentRepository, Transactional<IncidentRepository>
{
  bindTo(uow: UnitOfWork): IncidentRepository {
    return this
  }
}
```

`CrudRepository.save` is where adapters call `entity.commit()` after a successful write. [`InMemoryRepository`](/api/testing/in-memory-repository/) implements this shape.

## Related

- [Port](/api/domain/port/)
- [requireCapability](/api/runtime/interceptor/)
- [InMemoryRepository](/api/testing/in-memory-repository/)
