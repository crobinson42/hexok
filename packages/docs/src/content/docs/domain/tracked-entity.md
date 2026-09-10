---
title: TrackedEntity
description: Opt-in dirty tracking. Methods mutate this and return this.
sidebar:
  order: 2
---

`TrackedEntity` is opt-in dirty tracking for aggregates that mutate. Methods **mutate this** and return `this`. Nested writes dirty the parent key (`address`, not `address.city`).

`create` marks `isNew`. `restore` snapshots `original`. Construct through those factories, not `new`. `set` writes; `with` is a type error. `getChangedKeys` / `isDirty` / `commit` are the persistence helpers. Declared refusals throw, same as [Entity](/domain/entity/).

```ts
class Site extends TrackedEntity<SiteProps> {
  relocate(city: string, region: string): this {
    if (this.address.city === city) this.error('SAME_ADDRESS')
    this.set('address', { ...this.address, city, region })
    return this
  }
}
```

See also: [Entity](/domain/entity/).
