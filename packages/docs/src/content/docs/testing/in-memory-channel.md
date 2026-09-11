---
title: InMemoryChannel
description: In-process channel adapter. Records sent payloads.
sidebar:
  order: 5
---

`InMemoryChannel` implements [ChannelAdapter](/domain/channel-adapter/). Records `sent`. `stop()` closes connections.

```ts
const presence = InMemoryChannel.create<Actor>()
const app = App.test(useCases)
  .bind(ClientEvents, InMemoryBus.create())
  .route(ClientChannel, presence)
  .build()
await app.start()
await app.channels.client.join(actor, fakeSocket)
```

See also: [EventChannel](/application/event-channel/), [App.test](/testing/app-test/).
