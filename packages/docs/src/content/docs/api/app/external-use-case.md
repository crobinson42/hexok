---
title: ExternalUseCase
description: Public request/response application use case.
sidebar:
  order: 1
---

```ts
import { ExternalUseCase } from 'hexok/app'
```

An external use case is a public application command. HTTP and `app.local` can call it. It orchestrates: load through ports, ask the entity to change, save, publish, return. The entity owns the rule (`incident.close(now)`). The use case wires the steps.

Declare static `key`, `input`, `output`, `errors`, `ports`, and `guards`. Implement `execute`. Who may enter is the [guard](/hexok/api/app/guards/) list: `[] as const` is public, and omitting the field fails closed.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `trigger` | `'external'` | Discriminator for `App.from` / `isExternalUseCase`. Do not override. |
| `key` | `string` | Use-case id (`incident.close`). Unique among the callable family. |
| `input` | `StandardSchemaV1` | Request schema. Validated before `execute`. |
| `output` | `StandardSchemaV1` | Success schema. Types `execute`, `run`, and the contract. |
| `errors` | `ErrorMap` | Declared refusals. Keys become `errors.CODE()` on `ExecuteCtx`. |
| `ports` | `Record<string, PortToken>` | Port tokens keyed by the alias used in `execute`. |
| `guards` | `readonly Guard[]` | Who may enter, in order. Required. `[] as const` is public. Omitting the field fails closed. Use `as const`. |
| `publishes` | `readonly AnyEventCatalog[]` | Catalogs this use case may `publish` to. Use `as const`. |
| `channels` | `readonly EventChannelCtor[]` | Channels available as `channels` on execute ctx. Use `as const`. |

Without `as const` on `guards`, `publishes`, or `channels`, `CheckUseCase` fails the list. A wide `publishes` or `channels` list also widens catalog keys.

## Instance

| Name | Notes |
| --- | --- |
| `execute(ctx)` | Abstract. Subclasses take `ExecuteCtx<typeof ThisClass>`. |
| `unwrap(result)` | Throws `CodedError` from a fail `Result`. Same as `if (!result.ok) throw new CodedError({ code: result.code })`. |

## Example

```ts
class CloseIncident extends ExternalUseCase {
  static readonly key = 'incident.close'
  static readonly input = z.object({ id: z.string() })
  static readonly output = Incident.schema
  static readonly errors = { NOT_FOUND: { message: 'Incident not found' } } as const
  static readonly ports = { incidents: IncidentRepository, clock: Clock }
  static readonly guards = [] as const
  static readonly publishes = [DomainEvents] as const

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id)
    if (!incident) throw errors.NOT_FOUND()
    const closed = incident.close(ports.clock.now())
    await ports.incidents.save(closed)
    publish(new IncidentClosed({ id: closed.props.id, closedAt: closed.props.closedAt }))
    return closed.toProps()
  }
}
```

## Related

- [Guard](/hexok/api/app/guards/)
- [InternalUseCase](/hexok/api/app/internal-use-case/)
- [ExecuteCtx](/hexok/api/app/execute-ctx/)
- [EventUseCase](/hexok/api/app/event-use-case/)
- [App](/hexok/api/runtime/app/)
- [deriveContract](/hexok/api/app/contract/)
