---
title: Derived contract
description: Transport-neutral catalog from API use-case statics. Nested as app.contract.
sidebar:
  order: 7
---

`deriveContract` builds a transport-neutral catalog from API use-case classes: `key`, `input`, `output`, `errors`. Event use cases and `internal: true` API use cases are omitted. Duplicate `key` throws (including when an internal shares a key).

`incident.close` nests as `{ incident: { close } }` on `app.contract`.

See also: [HTTP RPC](/runtime/http-rpc/), [Local client](/runtime/local-client/).
