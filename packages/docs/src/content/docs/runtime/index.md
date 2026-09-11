---
title: Runtime
description: App.from is the composition root. build() is not callable until every port and catalog is provided.
sidebar:
  order: 0
---

`hexok/runtime` boots the app. `App.from(useCases)` is the composition root. `provide` ports, `bind` catalogs, then `build()`.

`build()` is not callable until every required port and catalog is provided — at compile time and at runtime.

HTTP RPC is one derived adapter. `app.local` is in-process invoke of the same use cases.

- [App.from](/runtime/app-from/) — composition
- [Completeness](/runtime/completeness/) — missing ports/catalogs are sentences
- [Interceptor](/runtime/interceptor/) — onion around use case, adapter, publish, dispatch
- [RpcMiddleware](/runtime/rpc-middleware/) — per-route request/response middleware
- [Local client](/runtime/local-client/) — `app.local.incident.close`
- [HTTP RPC](/runtime/http-rpc/) — derived `POST /rpc/incident/close`
- [start / stop](/runtime/start-stop/) — event handlers wait for start
- [Request context](/runtime/request-context/) — `.ctx<AppContext>`
