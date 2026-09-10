---
title: HTTP RPC
description: "POST /rpc/incident/close with { input }. Success is { ok, output }. Failure is { ok: false, error }."
sidebar:
  order: 6
---

`app.router.fetch` is a `fetch`-compatible handler. `incident.close` is `POST /rpc/incident/close`. Body is `{ input }` (optional `ctx`).

Success: `{ ok: true, output }`. On `CodedError`, HTTP status comes from the code:

- `NOT_FOUND` → 404
- `VALIDATION` → 400
- `FORBIDDEN` → 403
- `UNAUTHORIZED` → 401
- else → 409

Failure: `{ ok: false, error: { code, status, message, data? } }`. Unknown routes and non-POST are `404`.

```ts
await app.router.fetch(
  new Request('http://app/rpc/incident/close', {
    method: 'POST',
    body: JSON.stringify({ input: { id: '1' } }),
  }),
)
```

See also: [Derived contract](/application/derived-contract/).
