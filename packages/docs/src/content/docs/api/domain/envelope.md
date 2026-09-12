---
title: Envelope
description: Runtime event value on the wire, plus bus and queue adapter contracts.
sidebar:
  order: 5
---

```ts
import type {
  BusAdapter,
  CatalogKind,
  Envelope,
  EventAdapter,
  QueueAdapter,
  QueueConsumeCtx,
} from 'hexok/domain'
```

`kind` is copied from the catalog.

## Envelope

```ts
type Envelope<K, P, Cat, Kind, Ctx> = {
  key: K
  payload: P
  catalog: Cat
  kind: Kind
  occurredAt: Date
  ctx?: Ctx
  correlationId?: string
  causationId?: string
  meta: Record<string, unknown>
}
```

| Field | Notes |
| --- | --- |
| `key` | Event class key, e.g. `'incident.closed'`. |
| `payload` | Event payload. |
| `catalog` | Catalog name this event was published through. |
| `kind` | `'bus'` or `'queue'`. |
| `occurredAt` | When the event was wrapped for the wire. |
| `ctx` | Catalog ctx when `.ctx()` was declared; omitted otherwise. |
| `correlationId` | Copied from request ctx when that field is a string. |
| `causationId` | Copied from request ctx when that field is a string. |
| `meta` | Adapter/interceptor scratch. Hexok writes `{}`. |

`CatalogKind` is `'bus' | 'queue'`.

## BusAdapter

Fire-and-forget pub/sub. No ack, no consumer group.

| Member | Notes |
| --- | --- |
| `kind` | `'bus'` |
| `publish(envelope)` | Put one envelope on the bus. |
| `subscribe(key, handler)` | Register a handler for one event key. |
| `stop?()` | Tear down the adapter. |

## QueueAdapter

Work queue. One consumer in a group; ack/nack; `attempt`.

| Member | Notes |
| --- | --- |
| `kind` | `'queue'` |
| `publish(envelope)` | Put one envelope on the queue. |
| `consume(key, group, handler)` | Register a competing consumer. Handler receives `QueueConsumeCtx`. |
| `stop?()` | Tear down the adapter. |

### QueueConsumeCtx

| Member | Notes |
| --- | --- |
| `attempt` | 1-based delivery attempt. |
| `ack()` | Mark this delivery succeeded. |
| `nack()` | Reject this delivery so it can retry. |

`EventAdapter` is `BusAdapter | QueueAdapter`.

## Related

- [EventCatalog](/api/domain/event-catalog/)
- [wrapEvent](/api/runtime/wrap-event/)
- [InMemoryBus](/api/testing/in-memory-bus/)
- [InMemoryQueue](/api/testing/in-memory-queue/)
