---
title: ChannelAdapter
description: Local presence and send. Bound with .route(Channel, adapter).
sidebar:
  order: 9
---

A `ChannelAdapter` is local presence plus send. Bind it with [`.route(Channel, adapter)`](/application/event-channel/). It does not interpret routing hints or session claims.

```ts
interface ChannelAdapter<Session = unknown> {
  join(id: string, session: Session, connection: ChannelConnection): void
  leave(id: string): void
  eject(id: string): void
  update(id: string, session: Session): void
  list(): ReadonlyArray<{ id: string; session: Session }>
  send(id: string, payload: string): void
  stop?(): Promise<void>
}
```

`ChannelConnection` is `send` / `close` / `close` listener. WebSocket and SSE adapters wrap their native connection.

Tests use [InMemoryChannel](/testing/in-memory-channel/).

See also: [EventChannel](/application/event-channel/), [BusAdapter](/domain/bus-adapter/).
