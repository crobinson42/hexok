---
title: RPC
description: POST /rpc paths derived from API use-case keys.
sidebar:
  order: 4
---

```ts
import { deriveRpc, type RpcContract, type RpcRoute, rpcPath } from 'hexok/runtime'
```

## Exports

| Name | Kind | Notes |
| --- | --- | --- |
| `rpcPath(key)` | function | `'incident.close'` → `'/rpc/incident/close'` |
| `RpcRoute` | type | `UseCaseRoute` plus `method: 'POST'` and `path`. |
| `RpcContract<Bag>` | type | Flat `routes` plus nested keys (`rpc.incident.close.path`). |
| `deriveRpc(contract)` | function | Attach `POST /rpc/...` paths to each API route and nest by use-case key. |

```ts
rpcPath('incident.close') // '/rpc/incident/close'

const rpc = deriveRpc(deriveContract({ close: CloseIncident }))
rpc.routes['incident.close'].path
rpc.incident.close.path
```

`AppInstance.rpc` is this catalog. `router.fetch` handles `POST` to those paths with body `{ input }`.

## Related

- [deriveContract](/api/app/contract/)
- [AppInstance.rpc](/api/runtime/app/)
- [httpStatus](/api/runtime/http-status/)
