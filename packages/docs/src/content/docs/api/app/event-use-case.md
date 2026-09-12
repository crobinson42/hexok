---
title: EventUseCase
description: Event handler. Mutually exclusive with ExternalUseCase and InternalUseCase.
sidebar:
  order: 3
---

```ts
import { EventUseCase } from 'hexok/app'
```

Listens to one event class in one catalog. Queue catalogs require `static group`.

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

## Instance

| Name | Notes |
| --- | --- |
| `execute(ctx)` | Abstract. Returns `Promise<void>`. Subclasses take `EventCtx<typeof ThisClass>`. |
| `unwrap(result)` | Throws `CodedError` from a fail `Result`. |

Handlers subscribe only after `app.start()`.

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

- [EventCtx](/api/app/execute-ctx/)
- [DomainEvent](/api/domain/domain-event/)
- [EventCatalog](/api/domain/event-catalog/)
- [ExternalUseCase](/api/app/external-use-case/)
- [InternalUseCase](/api/app/internal-use-case/)
