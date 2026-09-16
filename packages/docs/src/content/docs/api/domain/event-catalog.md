---
title: EventCatalog
description: Registry of event classes. kind is bus (fan-out) or queue (competing consumers).
sidebar:
  order: 4
---

```ts
import {
  type AnyEventCatalog,
  type CatalogEvents,
  EventCatalog,
} from 'hexok/domain'
```

Named catalog. Chain `.event(...)` then `.freeze()`. Use-case field: `static publishes = [DomainEvents] as const`.

## Constructor

```ts
new EventCatalog(key, { kind: 'bus' | 'queue' })
```

| Name | Type | Notes |
| --- | --- | --- |
| `key` | `string` | Catalog name, copied onto envelopes. |
| `kind` | `'bus' \| 'queue'` | `'bus'` is fan-out; `'queue'` is one consumer in a group, ack/nack. |

## Methods

| Name | Notes |
| --- | --- |
| `ctx<C>()` | Require `ctx: C` on every event. Call before `.event()`. |
| `event(eventClass)` | Register an event class. Duplicate `key` throws. |
| `get(eventClass)` | Look up a registered class. Throws if it is not in this catalog. |
| `list()` | Registered event classes, in registration order. |
| `freeze()` | Seal the catalog. Further `.event()` / `.ctx()` throw. |

Dotted keys become nested properties when each segment is a JS identifier (`DomainEvents.incident.closed`).

## Instance

| Name | Type | Notes |
| --- | --- | --- |
| `hasCtx` | `boolean` | True after `.ctx()`. |
| `frozen` | `boolean` | True after `.freeze()`. |

## Types

| Name | Notes |
| --- | --- |
| `AnyEventCatalog` | Safe annotation / Map key. Bare `EventCatalog` has `Events = never`. |
| `CatalogEvents<Cat>` | Event classes registered on `Cat`, or `never` when empty. |

## Example

```ts
const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
  .event(IncidentClosed)
  .freeze()

DomainEvents.get(IncidentClosed)
DomainEvents.incident.closed
```

## Throws

- `hexok: catalog "…" already has ctx`
- `hexok: catalog "…" ctx() must be called before .event()`
- `hexok: duplicate event "…" in catalog "…"`
- `hexok: event "…" is not in catalog "…"`
- `hexok: catalog "…" is frozen`

## Related

- [DomainEvent](/hexok/api/domain/domain-event/)
- [Envelope](/hexok/api/domain/envelope/)
- [App.bind](/hexok/api/runtime/app/)
