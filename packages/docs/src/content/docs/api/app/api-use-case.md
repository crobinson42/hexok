---
title: ApiUseCase
description: Request/response application use case.
sidebar:
  order: 1
---

```ts
import { ApiUseCase } from 'hexok/app'
```

Declare static `key`, `input`, `output`, `errors`, `ports`. Implement `execute`.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `trigger` | `'api'` | Discriminator for `App.from` / `isApiUseCase`. Do not override. |
| `key` | `string` | Dotted RPC path (`incident.close`). Unique among API use cases. |
| `input` | `StandardSchemaV1` | Request schema. Validated before `execute`. |
| `output` | `StandardSchemaV1` | Success schema. Types `execute`, `run`, and the contract. |
| `errors` | `ErrorMap` | Declared refusals. Keys become `errors.CODE()` on `ExecuteCtx`. |
| `ports` | `Record<string, PortToken>` | Port tokens keyed by the alias used in `execute`. |
| `internal` | `boolean` | When true, omitted from contract, HTTP RPC, and `app.local`. Still in completeness. |
| `publishes` | `readonly AnyEventCatalog[]` | Catalogs this use case may `publish` to. Use `as const`. |
| `channels` | `readonly EventChannelCtor[]` | Channels available as `channels` on execute ctx. Use `as const`. |
| `middleware` | `readonly unknown[]` | RPC middleware for this use case, after app-level `App.use`. |

Without `as const` on `publishes` / `channels`, catalog keys widen.

## Instance

| Name | Notes |
| --- | --- |
| `execute(ctx)` | Abstract. Subclasses take `ExecuteCtx<typeof ThisClass>`. |
| `unwrap(result)` | Throws `CodedError` from a fail `Result`. Same as `if (!result.ok) throw new CodedError({ code: result.code })`. |

## Example

```ts
class CloseIncident extends ApiUseCase {
  static readonly key = 'incident.close'
  static readonly input = z.object({ id: z.string() })
  static readonly output = Incident.schema
  static readonly errors = { NOT_FOUND: { message: 'Incident not found' } } as const
  static readonly ports = { incidents: IncidentRepository, clock: Clock }
  static readonly publishes = [DomainEvents] as const

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id)
    if (!incident) throw errors.NOT_FOUND()
    const closed = incident.close(ports.clock.now())
    await ports.incidents.save(closed)
    publish(new IncidentClosed({ id: closed.id, closedAt: closed.closedAt }))
    return closed.toProps()
  }
}
```

## Related

- [ExecuteCtx](/api/app/execute-ctx/)
- [EventUseCase](/api/app/event-use-case/)
- [App](/api/runtime/app/)
- [deriveContract](/api/app/contract/)
