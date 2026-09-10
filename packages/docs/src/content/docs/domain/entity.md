---
title: Entity
description: Mutable aggregate. Domain methods mutate this via set and return this.
sidebar:
  order: 1
---

Entities are **mutable aggregates**. Domain methods mutate `this` and return `this`. They never I/O, never publish, never hold ports.

`set(draft => { … })` is the only supported write. `with()` is a type error and throws `plinth: Entity is mutable; use set()`.

Validation, invariants, and declared refusals **throw**. Check invariants in the method **before** `set`. `create` / `restore` / `parse` validate against `static schema` and throw `CodedError` `VALIDATION` if rejected. Construct through those factories, not `new`. `set` does not re-run the schema.

`toProps()` always shallow-copies. That is the snapshot for persistence and use-case output.

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
      draft.address = { ...draft.address, city, region }
    })
    return this
  }
}
```

Copy-on-write is lazy. `restore` / `list` / `get` do not snapshot. Tracking starts at the first `set`.

| Moment | Extra copy? |
| --- | --- |
| `restore` / `parse` / `get` / `list` | no |
| first `set` on a clean entity | one shallow copy |
| later `set` | no (in place) |
| `create` | one shallow copy |
| `commit` | no (aliases) |

`getChangedKeys()` is **shallow** by default (top-level `Object.is`). After `Site.relocate` that is `['address']`. `{ deep: true }` returns dot-string leaf paths (`['address.city', 'address.region']`). Arrays and `Date` are leaves. `isDirty()` is shallow (`isNew` or any shallow change) and never deep-walks.

Nested values start shared with original. Assign a new parent key:

```ts
this.set((draft) => {
  draft.address = { ...draft.address, city, region }
})
```

These writes are invisible to both shallow and deep diffs:

```ts
this.set((draft) => {
  draft.address.city = city // mutates the shared nested object
})
entity.props.address.city = city // same, via the live props getter
```

While clean, a top-level write through the live getter (`entity.props.id = 'x'`) mutates original and current together. Diffs stay empty; `toProps()` still contains the new value. Unsupported; use `set`.

See also: [CodedError](/core/coded-error/), [InMemoryRepository](/testing/in-memory-repository/), [Mapper](/infrastructure/mapper/).
