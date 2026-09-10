---
title: Derived RPC contract
description: Use-case key becomes a nested contract and POST /rpc/incident/close.
sidebar:
  order: 7
---

`deriveContract` builds the RPC contract from API use-case classes. Event use cases are omitted. Duplicate `key` throws.

`incident.close` nests as `{ incident: { close } }` and maps to `POST /rpc/incident/close` with `{ input }`.

```ts
rpcPath('incident.close') // '/rpc/incident/close'
```

The built app exposes `app.contract` (nested) and `app.rpc` (flat routes).

See also: [HTTP RPC](/runtime/http-rpc/), [Local client](/runtime/local-client/).
