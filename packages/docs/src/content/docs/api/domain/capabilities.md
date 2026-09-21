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

Capabilities are optional extra contracts on a port: transactions (`bindTo`), per-request isolation (`fork`), or a CRUD shape. Domain still only sees your port. Flag them on `Port.token` so `provide` checks the impl. `CrudRepository` is the shape [`InMemoryRepository`](/hexok/api/testing/in-memory-repository/) can fake; write your own port for everything else.

Pass `{ transactional: true }` / `{ requestScoped: true }` to [`Port.token`](/hexok/api/domain/port/) so `provide()` throws if the impl is missing `bindTo` / `fork`.

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

`CrudRepository.save` is where adapters call `entity.commit()` after a successful write. [`InMemoryRepository`](/hexok/api/testing/in-memory-repository/) implements this shape.

## Related

- [Port](/hexok/api/domain/port/)
- [requireCapability](/hexok/api/runtime/interceptor/)
- [InMemoryRepository](/hexok/api/testing/in-memory-repository/)
