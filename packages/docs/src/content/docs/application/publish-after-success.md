---
title: Publish after success
description: publish enqueues. The runtime flushes only if execute returns. A throw drops the queue.
sidebar:
  order: 6
---

`publish(...)` **enqueues**. The runtime flushes the queue only if `execute` returns. A throw drops the queue — publish after success, not a coincidence.

`publish` is typed to the catalogs in `static publishes`. You may pass a `DomainEvent` or an [Envelope](/domain/envelope/).

Publish flushes **after** the use-case interceptor onion, so a successful unit-of-work commit naturally yields after-commit publish.

```ts
publish(new IncidentClosed({ id: closed.value.id, closedAt: closed.value.closedAt }))
return closed.value.toProps()
```

See also: [Interceptor](/runtime/interceptor/), [EventUseCase](/application/event-use-case/).
