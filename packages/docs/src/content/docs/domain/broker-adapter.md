---
title: BrokerAdapter
description: Acked event adapter. consume takes a group and ack/nack.
sidebar:
  order: 8
---

A `BrokerAdapter` is an acked event adapter. Bind it to a catalog with `kind: 'broker'`. Event use cases on a broker catalog require `static group`.

`consume` receives `attempt`, `ack`, and `nack`. The handler’s `EventCtx` includes `attempt`.

```ts
interface BrokerAdapter {
  kind: 'broker'
  publish(envelope: Envelope): Promise<void>
  consume(
    key: string,
    group: string,
    handler: (envelope: Envelope, ctx: BrokerConsumeCtx) => Promise<void>,
  ): void
  stop?(): Promise<void>
}
```

Tests use [InMemoryBroker](/testing/in-memory-broker/).

See also: [EventUseCase](/application/event-use-case/).
