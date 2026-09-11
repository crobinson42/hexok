---
title: EventCatalog
description: Registry of event classes. kind is bus (fan-out) or queue (work once).
sidebar:
  order: 5
---

`EventCatalog` is a registry of event classes. `kind` is `'bus'` (fan-out, fire-and-forget, no persistence) or `'queue'` (work queue: one consumer in a group, ack/nack). `.event()` accumulates each class on the covariant `Events` generic.

Use-case convention: `static publishes = [DomainEvents] as const`. Without `as const`, `Events` widens and `publish` loses its type.

```ts
const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
  .event(IncidentClosed)
DomainEvents.get(IncidentClosed)
DomainEvents.incident.closed // when every segment is a JS identifier
```

`.ctx<T>()` (optional, before `.event()`) requires every registered class to have instance `ctx: T`. The app owns `T` — a delivery target, a room, a tenant key. Domain catalogs omit it. `wrapEvent` copies `event.ctx` onto [Envelope](/domain/envelope/) `ctx` only when the catalog declared `.ctx()`.

```ts
type ClientCtx = { room: string }
const ClientEvents = new EventCatalog('client', { kind: 'bus' })
  .ctx<ClientCtx>()
  .event(ChatSaid)
```

A second websocket or webhook feed is another catalog with its own `.ctx<T>()` and `.bind`. Client delivery uses an [EventChannel](/application/event-channel/) on a **bus** catalog — not a third `kind`.

`bind(DomainEvents, adapter)` freezes the catalog. Duplicate keys throw.

See also: [DomainEvent](/domain/domain-event/), [BusAdapter](/domain/bus-adapter/), [QueueAdapter](/domain/queue-adapter/), [EventChannel](/application/event-channel/).
