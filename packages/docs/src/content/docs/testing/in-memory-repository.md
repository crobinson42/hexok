---
title: InMemoryRepository
description: In-memory fake for the standard CRUD port. Clones on get/save.
sidebar:
  order: 2
---

`InMemoryRepository.of` fakes a [CrudRepository](/domain/crud-repository/) port `{ get, save, list, delete }`. It clones on get/save so tests do not mutate the store by accident. `save` full-replaces via `restore(toProps())` — `toProps()` is a deep frozen snapshot — then `commit()`s the working instance. It does not skip clean saves.

Extra methods on the port are a type error — write a custom fake.

```ts
.provide(IncidentRepository, InMemoryRepository.of(IncidentRepository, {
  keyBy: 'id',
  seed: [Incident.open('1')],
}))
```

See also: [Port](/domain/port/).
