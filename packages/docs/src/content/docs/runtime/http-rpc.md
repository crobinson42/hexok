---
title: HTTP RPC
description: "POST /rpc/incident/close with { input }. Success is { ok, output }. Failure is { ok: false, error }."
sidebar:
  order: 6
---

`app.router.fetch` is a `fetch`-compatible handler. `POST /rpc/<key>` with `{ input }` (optional `ctx`). Dots in the key become slashes: `incident.close` → `/rpc/incident/close`.

Success: `{ ok: true, output }`. `CodedError`: `{ ok: false, error: { code, status, message, data? } }` with that HTTP status. Unknown routes and non-POST are `404`.

```ts
await app.router.fetch(
  new Request('http://app/rpc/incident/close', {
    method: 'POST',
    body: JSON.stringify({ input: { id: '1' } }),
  }),
)
```

See also: [Derived RPC contract](/application/derived-rpc-contract/).
