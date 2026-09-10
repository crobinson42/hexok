---
title: BusAdapter
description: Fire-and-forget pub/sub. publish and subscribe, no ack, no persistence.
sidebar:
  order: 7
---

A `BusAdapter` is fire-and-forget pub/sub. Bind it to a catalog with `kind: 'bus'`. There is no ack, no consumer group, and no persistence in the contract — Redis pub/sub, NATS, or an in-process emitter all fit.

```ts
interface BusAdapter {
  kind: 'bus'
  publish(envelope: Envelope): Promise<void>
  subscribe(key: string, handler: (envelope: Envelope) => Promise<void>): void
  stop?(): Promise<void>
}
```

Tests use [InMemoryBus](/testing/in-memory-bus/).

See also: [BrokerAdapter](/domain/broker-adapter/), [EventCatalog](/domain/event-catalog/).
