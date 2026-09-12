---
title: wrapEvent
description: Wrap a domain event in an envelope, or pass an envelope through.
sidebar:
  order: 5
---

```ts
import { wrapEvent } from 'hexok/runtime'
```

```ts
function wrapEvent(
  event: DomainEvent | Envelope,
  catalogs: readonly AnyEventCatalog[],
  requestCtx?: unknown,
): Envelope
```

The event must belong to one of `catalogs`. An existing envelope is passed through (not cloned) and may have tracing fields filled in. Catalog `.ctx()` requires `ctx` on the event.

When `requestCtx` has string `correlationId` / `causationId`, those fields are copied onto the envelope.

```ts
const envelope = wrapEvent(new IncidentClosed({ id: '1', closedAt: now }), [
  DomainEvents,
])
await app.publish(envelope)
```

## Throws

- `hexok: event "…" is not in a bound catalog declared by publishes`
- `hexok: event "…" is missing ctx for catalog "…"`

## Related

- [Envelope](/api/domain/envelope/)
- [DomainEvent](/api/domain/domain-event/)
- [EventCatalog](/api/domain/event-catalog/)
