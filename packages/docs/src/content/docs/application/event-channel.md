---
title: EventChannel
description: Catalog-scoped delivery policy. Join, refresh, and route are app authority.
sidebar:
  order: 9
---

An `EventChannel` is catalog-scoped delivery policy. `join`, `refresh`, and `route` are app authority. Presence I/O is a [ChannelAdapter](/domain/channel-adapter/) passed to `.route()`.

Channels require a **bus** catalog. A [queue](/domain/queue-adapter/) catalog is competing work (Kafka, Redis Streams), not a presence fabric. Bind the bus for distribution; route the channel for local sockets.

```ts
class ClientChannel extends EventChannel {
  static readonly catalog = ClientEvents
  static readonly ports = { users: UserRepository }
  static readonly joinInput = actorSchema
  static readonly errors = { FORBIDDEN: { message: 'Forbidden' } }

  async join({ input, errors }: JoinCtx<typeof ClientChannel>) {
    if (input.type !== 'user') throw errors.FORBIDDEN()
    return input
  }

  async refresh({ session, ports }: RefreshCtx<typeof ClientChannel>) {
    const user = await ports.users.get(session.userId)
    if (!user) return 'eject'
    return { ...session, organizationIds: [...user.props.organizationIds] }
  }

  async route({ ctx, clients, send }: RouteCtx<typeof ClientChannel>) {
    for (const { id, session } of clients) {
      if (visibleTo(session, ctx)) await send(id)
    }
  }
}
```

Composition:

```ts
App.from(useCases)
  .bind(ClientEvents, redisOrMemoryBus)
  .route(ClientChannel, wsAdapter)
  .build()

await app.start()
await app.channels.client.join(actor, connection)
```

Use cases that eject or refresh declare the channel:

```ts
static readonly channels = [ClientChannel] as const

async execute({ channels }: ExecuteCtx<typeof KickUser>) {
  channels.client.ejectWhere((s) => s.userId === input.userId)
}
```

`app.channels.client.join` is the HTTP/WS accept path. Use-case `channels.client` has `list`, `eject` / `ejectWhere`, `refresh` / `refreshWhere`, and `update` — not `join`.

The wire payload is `{ key, catalog, payload, occurredAt }`. Envelope `ctx` is a routing hint and is not sent to the client.

See also: [EventCatalog](/domain/event-catalog/), [ChannelAdapter](/domain/channel-adapter/), [Publish after success](/application/publish-after-success/).
