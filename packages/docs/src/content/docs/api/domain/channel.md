---
title: ChannelAdapter
description: Local presence and send. Bound with App.route.
sidebar:
  order: 6
---

```ts
import type { ChannelAdapter, ChannelConnection } from 'hexok/domain'
```

Does not interpret routing hints or session claims. [EventChannel](/api/app/event-channel/) owns join, refresh, and route.

## ChannelConnection

Byte sink for one connected client.

| Member | Notes |
| --- | --- |
| `send(data)` | Write one frame to this client. |
| `close()` | Disconnect this client. |
| `addEventListener('close', listener)` | Subscribe to the native close. |

## ChannelAdapter

| Member | Notes |
| --- | --- |
| `join(id, session, connection)` | Bind a connected client into local presence. |
| `leave(id)` | Remove a client that left. |
| `eject(id)` | Force-disconnect a client. |
| `update(id, session)` | Replace the session attached to a connected id. |
| `list()` | Snapshot of `{ id, session }`. |
| `send(id, payload)` | Send a payload to one connected id. |
| `stop?()` | Tear down the adapter. |

```ts
App.from(useCases).route(ClientChannel, adapter)
```

## Related

- [EventChannel](/api/app/event-channel/)
- [App.route](/api/runtime/app/)
- [InMemoryChannel](/api/testing/in-memory-channel/)
