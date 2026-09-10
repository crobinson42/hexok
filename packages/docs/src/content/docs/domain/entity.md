---
title: Entity
description: Untracked entities are values. Domain methods return a new instance via with.
sidebar:
  order: 1
---

Untracked entities are **values**. Domain methods return a new instance via `with`. They never I/O, never publish, never hold ports.

Validation, invariants, and declared refusals **throw**. Methods that cannot fail return `this` (or a new instance) with no wrapper. `create` / `restore` / `parse` validate against `static schema` and throw `CodedError` `VALIDATION` if rejected. Construct through those factories, not `new`. `toProps()` is the plain snapshot for persistence.

```ts
class Incident extends Entity<IncidentProps> {
  static readonly key = 'Incident'
  static readonly schema = z.object({
    id: z.string(),
    status: z.enum(['open', 'closed']),
  })
  static readonly errors = { ALREADY_CLOSED: { message: 'Incident already closed' } } as const

  close(): Incident {
    if (this.props.status === 'closed') this.error('ALREADY_CLOSED')
    return this.with({ status: 'closed' })
  }
}
```

Prefer `Incident.error('ALREADY_CLOSED')` when you want the code checked against `static errors` at compile time.

See also: [TrackedEntity](/domain/tracked-entity/), [CodedError](/core/coded-error/).
