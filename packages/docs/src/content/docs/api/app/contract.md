---
title: Contract
description: Transport-neutral catalog derived from API use-case classes.
sidebar:
  order: 5
---

```ts
import {
  type DerivedContract,
  deriveContract,
  nestByKey,
  type UseCaseContract,
  type UseCaseRoute,
} from 'hexok/app'
```

Event use cases and `internal: true` are omitted. Duplicate `key` throws.

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `UseCaseRoute` | type | `{ key, input, output, errors }` |
| `UseCaseContract` | type | `{ routes: Record<string, UseCaseRoute> }` |
| `DerivedContract<Bag>` | type | Nested by use-case `key` (`incident.close` → `{ incident: { close } }`). |
| `deriveContract(useCases)` | function | Build a `UseCaseContract` from a use-case class map. |
| `nestByKey(entries)` | function | Nest dotted keys (`incident.close` → `{ incident: { close } }`). |

```ts
const contract = deriveContract({ close: CloseIncident })
contract.routes['incident.close']
```

`AppInstance.contract` is the nested `DerivedContract`. [`deriveRpc`](/api/runtime/rpc/) attaches `POST /rpc/...` paths.

## Throws

- `hexok: duplicate use-case key "…"`

## Related

- [ApiUseCase](/api/app/api-use-case/)
- [deriveRpc](/api/runtime/rpc/)
- [AppInstance.contract](/api/runtime/app/)
