---
title: InMemoryQueue
description: In-process queue. nack or a throw redelivers until maxAttempts.
sidebar:
  order: 4
---

```ts
import { InMemoryQueue } from 'hexok/testing'
```

Implements [`QueueAdapter`](/hexok/api/domain/envelope/). `nack` (or a throw) redelivers with `attempt + 1` up to `maxAttempts` (default 3).

## Statics

| Name | Notes |
| --- | --- |
| `create()` | Empty queue. Pass to `.bind(catalog, InMemoryQueue.create())`. |

## Instance

| Name | Notes |
| --- | --- |
| `kind` | `'queue'` |
| `published` | Envelopes passed to `publish`, in order (one entry per publish, not per attempt). |
| `maxAttempts` | Stop redelivering after this many attempts. Default `3`. |
| `publish(envelope)` | Record the envelope and dispatch every consumer group for its key. |
| `consume(key, group, handler)` | Register the consumer for `key`+`group`. Later calls replace that group. |
| `stop()` | Drop all consumers. Does not clear `published`. |

```ts
.bind(Jobs, InMemoryQueue.create())
```

## Related

- [QueueAdapter](/hexok/api/domain/envelope/)
- [EventUseCase](/hexok/api/app/event-use-case/)
- [App.test](/hexok/api/testing/app/)
