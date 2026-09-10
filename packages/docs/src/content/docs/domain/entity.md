---
title: Entity
description: Untracked entities are values. Domain methods return a new instance via with.
sidebar:
  order: 1
---

Untracked entities are **values**. Domain methods return a new instance via `with`. They never I/O, never publish, never hold ports.

`create` / `restore` / `parse` validate against `static schema` and return `Result<This, 'VALIDATION'>`. `toProps()` is the plain snapshot for persistence and RPC.

```ts
class Incident extends Entity<IncidentProps> {
  static readonly key = 'Incident'
  static readonly schema = z.object({
    id: z.string(),
    status: z.enum(['open', 'closed']),
  })
  static readonly errors = { ALREADY_CLOSED: { status: 409 } }

  close(): Result<Incident, 'ALREADY_CLOSED'> {
    if (this.props.status === 'closed') return fail('ALREADY_CLOSED')
    return ok(this.with({ status: 'closed' }))
  }
}
```

See also: [TrackedEntity](/domain/tracked-entity/), [Result](/core/result/).
