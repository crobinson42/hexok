---
title: InMemoryQueue
description: In-process queue. consume dispatches with attempt; ack and nack are recorded no-ops.
sidebar:
  order: 4
---

`InMemoryQueue` implements [QueueAdapter](/domain/queue-adapter/). Bind it to a `kind: 'queue'` catalog. `consume` dispatches with `attempt`; `ack` / `nack` are no-ops besides recording. `stop()` clears consumers.

```ts
.bind(Jobs, InMemoryQueue.create())
```

See also: [InMemoryBus](/testing/in-memory-bus/), [App.test](/testing/app-test/).
