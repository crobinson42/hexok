---
title: EventChannel
description: Catalog-scoped delivery policy. Join, refresh, and route are app authority.
sidebar:
  order: 7
---

```ts
import {
  type ChannelControl,
  type ChannelProps,
  type ChannelSession,
  EventChannel,
  type JoinCtx,
  type RefreshCtx,
  type RouteCtx,
} from 'hexok/app'
```

Presence I/O is a [`ChannelAdapter`](/api/domain/channel/) passed to `.route()`. The catalog must be a bus.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `trigger` | `'channel'` | Discriminator. Do not override. |
| `catalog` | `AnyEventCatalog` | Catalog whose events this channel delivers. Must be a bus. |
| `joinInput` | `StandardSchemaV1` | Join-claims schema. Validated before `join`. |
| `ports` | `Record<string, PortToken>` | Port tokens keyed by the alias used in join, refresh, and route. |
| `errors` | `ErrorMap` | Declared refusals. Keys become `errors.CODE()` on join/refresh. |

## Instance

| Name | Notes |
| --- | --- |
| `join(ctx)` | Admit a client and return the session to store. Subclasses take `JoinCtx`. |
| `refresh(ctx)` | Recompute a session; return `'eject'` to drop the client. Subclasses take `RefreshCtx`. |
| `route(ctx)` | Choose recipients for a catalog event via `send(id)`. Subclasses take `RouteCtx`. |
| `unwrap(result)` | Throws `CodedError` from a fail `Result`. |

## Types

| Name | Notes |
| --- | --- |
| `ChannelSession<C>` | Session type returned from `join`. |
| `JoinCtx<C>` | `{ input, ports, errors }` |
| `RefreshCtx<C>` | `{ session, ports, errors }` |
| `RouteCtx<C>` | `{ event, ctx, clients, ports, send }`. `ctx` is catalog context, not app request context. |
| `ChannelControl<Session>` | Presence handle: `list`, `eject`, `ejectWhere`, `refresh`, `refreshWhere`, `update`. |
| `ChannelProps<C>` | `channels` on execute ctx, keyed by catalog key from `static channels`. |

## Example

```ts
class ClientChannel extends EventChannel {
  static readonly catalog = ClientEvents
  static readonly joinInput = actorSchema

  async join({ input }: JoinCtx<typeof ClientChannel>) {
    return input
  }
  async refresh({ session }: RefreshCtx<typeof ClientChannel>) {
    return session
  }
  async route({ ctx, clients, send }: RouteCtx<typeof ClientChannel>) {
    for (const { id, session } of clients) {
      if (visibleTo(session, ctx)) await send(id)
    }
  }
}
```

## Related

- [ChannelAdapter](/api/domain/channel/)
- [App.route](/api/runtime/app/)
- [ExecuteCtx.channels](/api/app/execute-ctx/)
