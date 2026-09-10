---
title: DomainEvent
description: Domain events are classes. Construction types the payload; validation happens at the edge.
sidebar:
  order: 4
---

Domain events are classes. Construction types the payload; validation happens at the use-case / RPC edge, not in the constructor.

Register each class on an [EventCatalog](/domain/event-catalog/). Use cases `publish(new IncidentClosed({ ... }))`.

```ts
class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed'
  static readonly schema = z.object({
    id: z.string(),
    closedAt: z.date(),
  })
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super()
  }
}
```

See also: [EventCatalog](/domain/event-catalog/), [Envelope](/domain/envelope/).
