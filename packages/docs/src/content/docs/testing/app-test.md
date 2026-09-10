---
title: App.test
description: Same completeness as App.from, plus published capture and as(ctx).
sidebar:
  order: 1
---

`App.test` is the same builder as `App.from`, plus `published` (after `aroundPublish`) and `as(ctx)` to rebind request context.

```ts
const app = App.test({ close: CloseIncident })
  .provide(IncidentRepository, InMemoryRepository.of(IncidentRepository, {
    keyBy: 'id',
    seed: [Incident.open('1', 'Seeded')],
  }))
  .provide(Clock, { now: () => new Date() })
  .bind(DomainEvents, InMemoryBus.create())
  .build()

await app.local.incident.close({ id: '1' })
expect(app.published).toHaveLength(1)
```

See also: [App.from](/runtime/app-from/), [Request context](/runtime/request-context/).
