---
title: Mapper
description: One entity, two functions. Entity to row and row to entity.
sidebar:
  order: 1
---

```ts
import { Mapper } from 'hexok/infra'
```

Chain `Mapper.for(Entity).to(…).from(…)`.

## Statics

| Name | Notes |
| --- | --- |
| `for(entity)` | Start a mapper for this entity class. Returns `{ to }`. |

## Instance

| Name | Notes |
| --- | --- |
| `to(entity)` | Outbound. No parse. |
| `from(row)` | Run the inbound mapping. Rethrows `VALIDATION` from `parse` / `create` / `set`. |
| `unsafe()` | Same mapping, but `from` returns `Result` instead of throwing. |

`from` rethrows `VALIDATION` with message `hexok: model.from() failed entity.parse (trust boundary)`. Other errors propagate.

`restore` does not run the schema; `parse` does.

```ts
const IncidentMapper = Mapper.for(Incident)
  .to((e) => ({ id: e.id, closed_at: e.closedAt?.toISOString() ?? null }))
  .from((row) =>
    Incident.restore({
      id: row.id,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
    }),
  )

const row = IncidentMapper.to(incident)
const entity = IncidentMapper.from(row)
```

## Related

- [Entity](/api/domain/entity/)
- [Result](/api/core/result/)
- [CodedError](/api/core/coded-error/)
