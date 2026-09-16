---
title: App.test
description: Test composition root. Same completeness as App.from, plus published capture and as(ctx).
sidebar:
  order: 1
---

```ts
import { App, TestAppBuilder, type TestAppInstance } from 'hexok/testing'
```

Production composition is [`hexok/runtime` `App.from`](/hexok/api/runtime/app/).

## App.test

```ts
App.test(useCases: Bag): TestAppBuilder<Bag>
```

Same `provide` / `bind` / `route` / `ctx` / `ctxFrom` / `adapt` / `use` / `intercept` / `build` as runtime.

`App.test` already registers an interceptor (`hexok:published`) that records envelopes after `aroundPublish`. Further `intercept` calls still apply; first registered is outer.

## TestAppInstance

`AppInstance` plus:

| Member | Notes |
| --- | --- |
| `published` | Envelopes that completed `aroundPublish`, in order. |
| `as(ctx)` | Nested local client with `ctx` fixed on every call. |

## Example

```ts
const app = App.test({ close: CloseIncident })
  .provide(
    IncidentRepository,
    InMemoryRepository.of(IncidentRepository, {
      keyBy: 'id',
      seed: [Incident.open('1', 'Seeded')],
    }),
  )
  .provide(Clock, { now: () => new Date() })
  .bind(DomainEvents, InMemoryBus.create())
  .build()

await app.local.incident.close({ id: '1' })
app.published.length
app.as({ requestId: 't1' }).incident.close({ id: '1' })
```

## Related

- [App](/hexok/api/runtime/app/)
- [InMemoryRepository](/hexok/api/testing/in-memory-repository/)
- [InMemoryBus](/hexok/api/testing/in-memory-bus/)
- [InMemoryQueue](/hexok/api/testing/in-memory-queue/)
- [InMemoryChannel](/hexok/api/testing/in-memory-channel/)
