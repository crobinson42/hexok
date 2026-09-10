---
title: App.from
description: Composition root. provide ports, bind catalogs, then build.
sidebar:
  order: 1
---

`App.from` takes the use-case bag. Chain `provide(token, impl)`, `bind(catalog, adapter)`, optional `ctx`, `use`, and `intercept`. Then `build()`.

Duplicate `provide` / `bind` / interceptor keys throw. Catalog `kind` must match the adapter.

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

See also: [Completeness](/runtime/completeness/), [Testing App.test](/testing/app-test/).
