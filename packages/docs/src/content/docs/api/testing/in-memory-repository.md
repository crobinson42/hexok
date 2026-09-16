---
title: InMemoryRepository
description: In-memory fake for a CRUD port. Clones on get and save.
sidebar:
  order: 2
---

```ts
import { InMemoryRepository } from 'hexok/testing'
```

Implements [`CrudRepository`](/hexok/api/domain/capabilities/) `{ get, save, list, delete }`. Extra methods beyond those (and `bindTo` / `fork`) go in `extra`.

## Statics

| Name | Notes |
| --- | --- |
| `of(token, options)` | Fake a CRUD port. `options.keyBy` is the entity prop used as the store key. |

```ts
.provide(
  IncidentRepository,
  InMemoryRepository.of(IncidentRepository, {
    keyBy: 'id',
    seed: [Incident.open('1', 'Seeded')],
    extra: { findOpen: async () => [] },
  }),
)
```

`keyBy` must be a string prop on `toProps()`. Seed entities are cloned into the store.

## Instance

| Name | Notes |
| --- | --- |
| `get(id)` | Clone of the stored entity, or `null`. |
| `save(entity)` | Clone into the store and `commit()` the working entity. |
| `list()` | Clones of every stored entity. |
| `delete(id)` | Remove by id. No-op if missing. |

## Throws

- `hexok: InMemoryRepository keyBy "…" is not a string`

The type of `of` is `hexok: InMemoryRepository.of expects a CRUD repository port` when the port lacks `get` / `save`.

## Related

- [CrudRepository](/hexok/api/domain/capabilities/)
- [Entity](/hexok/api/domain/entity/)
- [App.test](/hexok/api/testing/app/)
