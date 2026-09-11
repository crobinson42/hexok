---
title: EventUseCase
description: Event handler. Mutually exclusive with ApiUseCase. Queue catalogs require static group.
sidebar:
  order: 2
---

`EventUseCase` is an event handler. It is mutually exclusive with `ApiUseCase`. Declare `on` (the event class) and `catalog`. Queue catalogs require `static group`. The runtime constructs the class; do not `new` it.

Handlers do **not** run until [`app.start()`](/runtime/start-stop/).

```ts
class NotifyOnClose extends EventUseCase {
  static readonly key = 'incident.notifyOnClose'
  static readonly on = IncidentClosed
  static readonly catalog = DomainEvents
  static readonly ports = { notifier: Notifier }

  async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
    await ports.notifier.send(event.payload)
  }
}
```

`static on` must be a class registered on `static catalog`, or `App.from` types an error sentence.

See also: [EventCatalog](/domain/event-catalog/), [ExecuteCtx](/application/execute-ctx/).
