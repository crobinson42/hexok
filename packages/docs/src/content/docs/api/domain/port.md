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

A port is a TypeScript interface plus a token. `App.provide` and `static ports` take the token.

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

`.build()` names a missing port by its use-case alias (`ports: { incidents: IncidentRepository }` → `"incidents"`).

## Types

| Name | Notes |
| --- | --- |
| `PortCapabilities` | `{ transactional?: boolean; requestScoped?: boolean }` |
| `PortType<T>` | Interface stored on a `PortToken`. |

## Related

- [Capabilities](/api/domain/capabilities/)
- [Adapter](/api/infra/adapter/)
- [App.provide](/api/runtime/app/)
- [requireCapability](/api/runtime/interceptor/)
