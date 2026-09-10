---
title: TrackedEntity
description: Opt-in dirty tracking. Methods mutate this and return ok(this).
sidebar:
  order: 2
---

`TrackedEntity` is opt-in dirty tracking for aggregates that mutate. Methods **mutate this** and return `ok(this)`. Nested writes dirty the parent key (`address`, not `address.city`).

`create` marks `isNew`. `restore` snapshots `original`. `set` writes; `with` is a type error. `getChangedKeys` / `isDirty` / `commit` are the persistence helpers.

```ts
class Site extends TrackedEntity<SiteProps> {
  relocate(city: string, region: string): Result<this, 'SAME_ADDRESS'> {
    if (this.address.city === city) return fail('SAME_ADDRESS')
    this.set('address', { ...this.address, city, region })
    return ok(this)
  }
}
```

See also: [Entity](/domain/entity/).
