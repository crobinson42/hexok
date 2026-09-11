---
title: start and stop
description: Event handlers do not run until app.start(). stop() tears down adapters.
sidebar:
  order: 7
---

Event use cases and [channels](/application/event-channel/) do **not** run until `app.start()`. `start()` subscribes/consumes on bound adapters and starts routed channels. Calling `start()` twice throws. `stop()` closes channel adapters and bound catalog adapters.

API use cases via `local` or HTTP work before `start()`. Only handlers and channel fan-out wait. Join may run before `start()`; envelopes do not fan out until start.

```ts
await app.start() // event handlers do not run until start()
await app.stop()
```

See also: [EventUseCase](/application/event-use-case/).
