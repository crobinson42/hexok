---
title: InMemoryBus
description: In-process bus. Records published. stop() clears subscribers.
sidebar:
  order: 3
---

```ts
import { InMemoryBus } from 'hexok/testing'
```

Implements [`BusAdapter`](/hexok/api/domain/envelope/).

## Statics

| Name | Notes |
| --- | --- |
| `create()` | Empty bus. Pass to `.bind(catalog, InMemoryBus.create())`. |

## Instance

| Name | Notes |
| --- | --- |
| `kind` | `'bus'` |
| `published` | Envelopes passed to `publish`, in order. |
| `publish(envelope)` | Record the envelope, then await each subscriber for its key. |
| `subscribe(key, handler)` | Register a handler for `key`. Cleared by `stop()`. |
| `stop()` | Drop all subscribers. Does not clear `published`. |

```ts
.bind(DomainEvents, InMemoryBus.create())
```

## Related

- [BusAdapter](/hexok/api/domain/envelope/)
- [App.bind](/hexok/api/runtime/app/)
- [App.test](/hexok/api/testing/app/)
