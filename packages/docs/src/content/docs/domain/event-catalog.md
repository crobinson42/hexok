---
title: EventCatalog
description: Registry of event classes. kind is bus (fire-and-forget pub/sub) or broker (acked).
sidebar:
  order: 5
---

`EventCatalog` is a registry of event classes. `kind` is `'bus'` (pub/sub, fire-and-forget, no persistence) or `'broker'` (acked consume with groups). `.event()` accumulates each class on the covariant `Events` generic.

Use-case convention: `static publishes = [DomainEvents] as const`. Without `as const`, `Events` widens and `publish` loses its type.

```ts
const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
  .event(IncidentClosed)
DomainEvents.get(IncidentClosed)
DomainEvents.incident.closed // when every segment is a JS identifier
```

`bind(DomainEvents, adapter)` freezes the catalog. Duplicate keys throw.

See also: [DomainEvent](/domain/domain-event/), [BusAdapter](/domain/bus-adapter/), [BrokerAdapter](/domain/broker-adapter/).
