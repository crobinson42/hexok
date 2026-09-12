---
title: DomainEvent
description: Event class. Construction types the payload; validation runs at the use-case / RPC edge.
sidebar:
  order: 3
---

```ts
import {
  DomainEvent,
  type EventClass,
  type EventPayload,
  type EventWithCtx,
} from 'hexok/domain'
```

Subclass with `key`, `schema`, and a typed `payload`. The constructor does not validate.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `key` | `string` | Dotted event name, e.g. `'incident.closed'`. |
| `schema` | `StandardSchemaV1` | Payload schema, applied at the use-case / RPC edge. |

## Instance

| Name | Type | Notes |
| --- | --- | --- |
| `payload` | `P` | Event body. Typed by the subclass constructor. |

## Types

| Name | Notes |
| --- | --- |
| `EventClass<P>` | Constructor: `key`, `schema`, and `new (payload)`. |
| `EventPayload<E>` | Payload type inferred from `E['schema']`. |
| `EventWithCtx<E, Ctx>` | `catalog.event()` argument when the catalog declared `.ctx<T>()`. |

## Example

```ts
class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed'
  static readonly schema = z.object({ id: z.string(), closedAt: z.date() })
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super()
  }
}
```

## Related

- [EventCatalog](/api/domain/event-catalog/)
- [Envelope](/api/domain/envelope/)
- [EventUseCase](/api/app/event-use-case/)
- [wrapEvent](/api/runtime/wrap-event/)
