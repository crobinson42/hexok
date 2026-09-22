---
title: EventUseCase
description: Event handler. Mutually exclusive with ExternalUseCase and InternalUseCase.
sidebar:
  order: 3
---

```ts
import { EventUseCase } from 'hexok/app'
```

An event use case handles one event from one catalog — notify, update another aggregate, enqueue follow-up work. Handlers subscribe only after `app.start()`. Queue catalogs require `static group`. [Guards](/hexok/api/app/guards/) are optional. Omit them and every delivery runs.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `trigger` | `'event'` | Discriminator for `App.from` / `isEventUseCase`. Do not override. |
| `key` | `string` | Handler id (`incident.notifyOnClose`). Used in completeness messages. |
| `on` | `EventClass` | Event class this handler listens to. Must be in `catalog`. |
| `catalog` | `AnyEventCatalog` | Catalog that owns `on`. Bind it with `App.bind`. |
| `group` | `string` | Consumer group. Required when `catalog.kind` is `'queue'`. |
| `ports` | `Record<string, PortToken>?` | Port tokens keyed by the alias used in `execute`. Optional. |
| `errors` | `ErrorMap?` | Declared refusals. Keys become `errors.CODE()` on `EventCtx`. Defaults to `{}`. |
| `publishes` | `readonly AnyEventCatalog[]` | Catalogs this handler may `publish` to. Use `as const`. |
| `channels` | `readonly EventChannelCtor[]` | Channels available as `channels` on event ctx. Use `as const`. |
| `guards` | `readonly Guard[]?` | Optional. Omitted or empty skips. Use `as const` when set. |

## Instance

| Name | Notes |
| --- | --- |
| `execute(ctx)` | Abstract. Returns `Promise<void>`. Subclasses take `EventCtx<typeof ThisClass>`. |
| `unwrap(result)` | Throws `CodedError` from a fail `Result`. |

Handlers subscribe only after `app.start()`.

When `guards` is set, the context is only `App.ctx()` or a per-invoke `{ ctx }` from a custom dispatcher — never `ctxFrom`, and never the envelope. `app.start()` does not pass `{ ctx }`. An HTTP-identity guard such as `authenticated` is almost always wrong here: the default context has no actor, so every delivery is refused.

## Example

```ts
class NotifyOnClose extends EventUseCase {
  static readonly key = 'incident.notifyOnClose'
  static readonly on = IncidentClosed
  static readonly catalog = DomainEvents
  static readonly ports = { notifier: Notifier }

  async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
    await ports.notifier.send(event.payload)
  }
}
```

## Related

- [Guard](/hexok/api/app/guards/)
- [EventCtx](/hexok/api/app/execute-ctx/)
- [DomainEvent](/hexok/api/domain/domain-event/)
- [EventCatalog](/hexok/api/domain/event-catalog/)
- [ExternalUseCase](/hexok/api/app/external-use-case/)
- [InternalUseCase](/hexok/api/app/internal-use-case/)
