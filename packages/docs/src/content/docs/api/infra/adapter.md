---
title: Adapter
description: Pair a port token with a factory.
sidebar:
  order: 2
---

```ts
import { Adapter } from 'hexok/infra'
```

An adapter is the infra class that implements a domain port — Postgres, a real clock, an HTTP client. `Adapter.of` pairs the port token with a factory. Pass the created **impl** to `App.provide`, or use `App.adapt(factory, ...deps)`.

## Adapter.of

```ts
Adapter.of<I, Deps extends unknown[]>(
  token: PortToken<I>,
  create: (...deps: Deps) => I,
): { token: PortToken<I>; create: (...deps: Deps) => I }
```

```ts
const factory = Adapter.of(
  IncidentRepository,
  (db: Pool) => new PgIncidentRepo(db),
)

const impl = factory.create(pool)
App.from(useCases).provide(factory.token, impl)

App.from(useCases).adapt(factory, pool)
```

## Related

- [Port](/hexok/api/domain/port/)
- [App.adapt](/hexok/api/runtime/app/)
