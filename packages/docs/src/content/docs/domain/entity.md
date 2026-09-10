---
title: Entity
description: Mutable aggregate. Domain methods mutate this via set and return this.
sidebar:
  order: 1
---

Entities are **mutable aggregates**. Domain methods mutate `this` and return `this`. They never I/O, never publish, never hold ports.

`set(draft => { … })` is the only supported write. Nested assignment inside `set` is fine. `props` and `original` are `DeepReadonly` (exported from `plinth/domain`).

Validation, invariants, and declared refusals **throw**. Check invariants in the method **before** `set`. `create` / `restore` / `parse` validate against `static schema` and throw `CodedError` `VALIDATION` if rejected. Construct through those factories, not `new`. `set` does not re-run the schema.

`toProps()` is a deep frozen snapshot for persistence and use-case output. The same object is reused until the next `set` that writes.

Adapters **may** use `isNew` / `getChangedKeys()`. After persisting they call `entity.commit()` on the working instance. Use-cases never call `commit()`. Use-cases that return changed keys read them **before** `save`.

```ts
class Incident extends Entity<IncidentProps> {
  static readonly key = 'Incident'
  static readonly schema = z.object({
    id: z.string(),
    status: z.enum(['open', 'closed']),
    closedAt: z.date().nullable(),
  })
  static readonly errors = { ALREADY_CLOSED: { message: 'Incident already closed' } } as const

  close(now: Date): this {
    if (this.props.status === 'closed') Incident.error('ALREADY_CLOSED')
    return this.set((draft) => {
      draft.status = 'closed'
      draft.closedAt = now
    })
  }
}
```

Prefer `Incident.error('ALREADY_CLOSED')` when you want the code checked against `static errors` at compile time.

```ts
class Site extends Entity<SiteProps> {
  relocate(city: string, region: string): this {
    if (
      this.props.address.city === city &&
      this.props.address.region === region
    ) {
      this.error('SAME_ADDRESS')
    }
    this.set((draft) => {
      draft.address.city = city
      draft.address.region = region
    })
    return this
  }
}
```

Copy-on-write is lazy. `restore` / `list` / `get` do not snapshot. Tracking starts at the first write in `set`. `set` copies each node on the path that is still shared with original; later writes to those copies are in place. Assign a new `Date`; arrays copy on index writes.

| Moment | Extra copy? |
| --- | --- |
| `restore` / `parse` / `get` / `list` | no |
| first write in `set` | shallow copy of each node on the path |
| later `set` on already-copied nodes | no (in place) |
| `create` | one shallow root copy |
| `commit` | no (aliases) |
| first `toProps` / `toProps` after `set` | one deep clone (frozen) |
| later `toProps` with no `set` | no (cached) |

`getChangedKeys()` is **shallow** by default (top-level `Object.is`). After `Site.relocate` that is `['address']`. `{ deep: true }` returns dot-string leaf paths (`['address.city', 'address.region']`). Arrays and `Date` are leaves. `isDirty()` is shallow (`isNew` or any shallow change) and never deep-walks.

See also: [CodedError](/core/coded-error/), [InMemoryRepository](/testing/in-memory-repository/), [Mapper](/infrastructure/mapper/).
