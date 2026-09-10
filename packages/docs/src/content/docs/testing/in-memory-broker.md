---
title: InMemoryBroker
description: In-process broker. consume dispatches with attempt; ack and nack are recorded no-ops.
sidebar:
  order: 4
---

`InMemoryBroker` implements [BrokerAdapter](/domain/broker-adapter/). Bind it to a `kind: 'broker'` catalog. `consume` dispatches with `attempt`; `ack` / `nack` are no-ops besides recording. `stop()` clears consumers.

```ts
.bind(Jobs, InMemoryBroker.create())
```

See also: [InMemoryBus](/testing/in-memory-bus/), [EventUseCase](/application/event-use-case/).
