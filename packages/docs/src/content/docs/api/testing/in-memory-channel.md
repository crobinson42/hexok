---
title: InMemoryChannel
description: In-process channel adapter. Records sent. stop() closes connections.
sidebar:
  order: 5
---

```ts
import { InMemoryChannel } from 'hexok/testing'
```

Implements [`ChannelAdapter`](/api/domain/channel/).

## Statics

| Name | Notes |
| --- | --- |
| `create<S>()` | Empty channel. Pass to `.route(Channel, InMemoryChannel.create())`. |

## Instance

| Name | Notes |
| --- | --- |
| `sent` | `{ id, payload }` records from `send`, in order. |
| `join(id, session, connection)` | Track a connected client. Replaces an existing row with the same `id`. Close listener calls `leave`. |
| `leave(id)` | Drop the client without closing the connection. |
| `eject(id)` | Close the connection; the `close` listener then `leave`s. |
| `update(id, session)` | Replace session claims. No-op if unknown `id`. |
| `list()` | Snapshot of connected `{ id, session }` rows. |
| `send(id, payload)` | Record and deliver `payload` to `id`. Leaves the client if `send` throws. |
| `stop()` | Close every connection and clear clients. Does not clear `sent`. |

```ts
.route(ClientChannel, InMemoryChannel.create())
```

## Related

- [ChannelAdapter](/api/domain/channel/)
- [EventChannel](/api/app/event-channel/)
- [App.test](/api/testing/app/)
