---
title: QueueAdapter
description: Work queue. consume takes a group and ack/nack.
sidebar:
  order: 8
---

A `QueueAdapter` is a work queue. Bind it to a catalog with `kind: 'queue'`. Event use cases on a queue catalog require `static group`. One consumer in the group handles each envelope; ack / nack; `attempt`.

```ts
interface QueueAdapter {
  kind: 'queue'
  publish(envelope: Envelope): Promise<void>
  consume(
    key: string,
    group: string,
    handler: (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>,
  ): void
  stop?(): Promise<void>
}
```

Tests use [InMemoryQueue](/testing/in-memory-queue/).

See also: [EventUseCase](/application/event-use-case/).
