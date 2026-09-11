---
title: App.from
description: Composition root. provide ports, bind catalogs, then build.
sidebar:
  order: 1
---

`App.from` takes the use-case bag. Chain `provide(token, impl)`, `bind(catalog, adapter)`, optional `.route(channel, adapter)`, `ctx`, `use`, and `intercept`. Then `build()`.

List `internal: true` use cases in the bag so completeness still requires their ports and catalogs. They are omitted from `app.local` and HTTP in both `App.from` and `App.test` — invoke them through a public parent (or `run`). There is no `app.internal` in v1.

Duplicate `provide` / `bind` / `route` / interceptor keys throw. Catalog `kind` must match the adapter. Channels require a bus catalog.

```ts
const app = App.from(useCases)
  .provide(IncidentRepository, repo)
  .provide(Clock, clock)
  .bind(DomainEvents, bus)
  .ctx<AppContext>({ requestId: 'boot' })
  .build()

await app.local.incident.close({ id: '1' })
await app.start()
await app.stop()
```

See also: [Completeness](/runtime/completeness/), [EventChannel](/application/event-channel/), [Testing App.test](/testing/app-test/).
