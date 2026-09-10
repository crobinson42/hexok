---
title: Mapper
description: One entity, two functions. Inbound from is the trust boundary.
sidebar:
  order: 2
---

`Mapper` is one entity, two functions. Outbound `to` is a plain map — no parse. Inbound `from` is the **trust boundary**: it throws if `entity.parse` / `restore` fails.

`unsafe().from` returns a `Result` instead of throwing.

```ts
const IncidentMapper = Mapper.for(Incident)
  .to((e) => ({ id: e.id, closed_at: e.closedAt?.toISOString() ?? null }))
  .from((row) => Incident.restore({
    id: row.id,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
  }))
```

See also: [Entity](/domain/entity/), [Standard Schema](/core/standard-schema/).
