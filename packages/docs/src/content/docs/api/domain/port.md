---
title: Port
description: Token for a port interface, used at compose time.
sidebar:
  order: 2
---

```ts
import {
  Port,
  type PortCapabilities,
  PortToken,
  type PortType,
} from 'hexok/domain'
```

A port is a contract for something the application needs from the outside world — a repository, a clock, a mailer. You define the interface in domain and a token with `Port.token`. Use cases list those tokens on `static ports`. At boot, infra provides the real implementation with `App.provide`.

## Port.token

```ts
Port.token<I>(key: string, capabilities?: PortCapabilities): PortToken<I>
```

Create a token for interface `I`. Do not construct `PortToken` with `new`.

```ts
export interface IncidentRepository {
  get(id: string): Promise<Incident | null>
  save(incident: Incident): Promise<void>
}
export const IncidentRepository = Port.token<IncidentRepository>(
  'IncidentRepository',
)
```

Pass `{ transactional: true }` / `{ requestScoped: true }` so `provide` throws if the impl is missing `bindTo` / `fork`.

## PortToken

| Name | Type | Notes |
| --- | --- | --- |
| `key` | `string` | Name used in runtime provide/completeness errors. |
| `capabilities` | `{ transactional: boolean; requestScoped: boolean }` | Frozen. Checked by `App.provide`. |

The compile-time type of `.build()` names a missing port by its use-case alias (`ports: { incidents: IncidentRepository }` → `"incidents"`). Runtime throws use the token key (`"IncidentRepository"`).

## Types

| Name | Notes |
| --- | --- |
| `PortCapabilities` | `{ transactional?: boolean; requestScoped?: boolean }` |
| `PortType<T>` | Interface stored on a `PortToken`. |

## Related

- [Capabilities](/hexok/api/domain/capabilities/)
- [Adapter](/hexok/api/infra/adapter/)
- [App.provide](/hexok/api/runtime/app/)
- [requireCapability](/hexok/api/runtime/interceptor/)
