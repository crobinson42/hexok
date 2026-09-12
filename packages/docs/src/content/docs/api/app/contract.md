---
title: Contract
description: Transport-neutral catalog derived from external use-case classes.
sidebar:
  order: 5
---

```ts
import {
  type CatalogEntry,
  type DerivedContract,
  deriveContract,
  nestByKey,
  type UseCaseContract,
} from 'hexok/app'
```

Event use cases and InternalUseCase are omitted. Duplicate `key` throws.

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `CatalogEntry` | type | `{ key, input, output, errors }` — wide runtime catalog row. |
| `UseCaseContract` | type | `{ entries: Record<string, CatalogEntry> }` |
| `DerivedContract<Bag>` | type | Nested by use-case `key` (`incident.close` → `{ incident: { close } }`). Leaf types stay the subclass schemas, not `CatalogEntry`. |
| `deriveContract(useCases)` | function | Build a `UseCaseContract` from a use-case class map. |
| `nestByKey(entries)` | function | Nest dotted keys (`incident.close` → `{ incident: { close } }`). |

```ts
const contract = deriveContract({ close: CloseIncident })
contract.entries['incident.close']
```

`AppInstance.contract` is the nested `DerivedContract`. [`deriveRpc`](/api/runtime/rpc/) attaches `POST /rpc/...` paths.

## Throws

- `hexok: duplicate use-case key "…"`

## Related

- [ExternalUseCase](/api/app/external-use-case/)
- [InternalUseCase](/api/app/internal-use-case/)
- [deriveRpc](/api/runtime/rpc/)
- [AppInstance.contract](/api/runtime/app/)
