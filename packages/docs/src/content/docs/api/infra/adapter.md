---
title: Adapter
description: Pair a port token with a factory.
sidebar:
  order: 2
---

```ts
import { Adapter } from 'hexok/infra'
```

Pass the **impl** to `provide`, or use `App.adapt(factory, ...deps)`. Do not pass the holder to `provide`.

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

- [Port](/api/domain/port/)
- [App.adapt](/api/runtime/app/)
