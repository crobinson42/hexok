---
title: Adapter
description: Typed factory holder. Composition still receives the impl, not this object.
sidebar:
  order: 1
---

`Adapter.of` holds a typed factory for a port. Call `create(...)` and pass the result to `App.provide`. Composition receives the **impl**, not the factory object.

```ts
const factory = Adapter.of(IncidentRepository, (db: Pool) => new PgIncidentRepo(db))
const app = App.from(useCases).provide(IncidentRepository, factory.create(pool))
```

See also: [Port](/domain/port/), [App.from](/runtime/app-from/).
