---
title: Publish after success
description: publish enqueues. The runtime flushes only if execute returns. A throw drops the queue.
sidebar:
  order: 6
---

`publish(...)` **enqueues**. The runtime flushes the queue only if `execute` returns. A throw drops the queue — publish after success, not a coincidence.

`publish` is typed to the catalogs in `static publishes`. You may pass a `DomainEvent` or an [Envelope](/domain/envelope/).

Nested [`run`](/application/execute-ctx/) publishes onto the **outer** queue. Inner `wrapEvent` still checks the child’s `publishes`. Flush happens only if the outer `execute` returns; an outer throw drops both parent and child events.

Publish flushes **after** the use-case interceptor onion, so a successful unit-of-work commit naturally yields after-commit publish.

```ts
publish(new IncidentClosed({ id: closed.id, closedAt: closed.closedAt }))
return closed.toProps()
```

See also: [Interceptor](/runtime/interceptor/), [EventUseCase](/application/event-use-case/).
