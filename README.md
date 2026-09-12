# Hexok

[![CI](https://github.com/crobinson42/hexok/actions/workflows/ci.yml/badge.svg)](https://github.com/crobinson42/hexok/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hexok)](https://www.npmjs.com/package/hexok)

Hexok (Hexo Kit) is a TypeScript kit for writing a clean-architecture backend as **ordinary classes**: Entity, Port, Adapter, UseCase, Event, Interceptor.

A new hire should open a use-case file and understand the business flow without a glossary of hidden methods, phantom fields, or `meta` bags.

## Install

```bash
npm i hexok
```

Import from a layer. There is no root barrel — that keeps the public API aligned with the architecture.

```ts
import { Entity } from 'hexok/domain'
import { ExternalUseCase } from 'hexok/app'
import { App } from 'hexok/runtime'
import { App as TestApp, InMemoryRepository } from 'hexok/testing'
```

| Import | What it is |
| --- | --- |
| `hexok/core` | `Result`, Standard Schema V1, `ErrorMap` |
| `hexok/domain` | `Entity`, `DeepReadonly`, `Port`, `EventCatalog`, `DomainEvent` |
| `hexok/app` | `ExternalUseCase`, `InternalUseCase`, `EventUseCase`, contract derivation |
| `hexok/infra` | `Mapper` (entity ↔ row), `Adapter.of` |
| `hexok/runtime` | `App.from` composition, completeness, interceptors, local client, HTTP |
| `hexok/testing` | Test-only: `App.test`, in-memory repo/bus/queue/channel, `published` |

Docs site: `npm run dev -w @hexok/docs`.

## Write a use case

```ts
class CloseIncident extends ExternalUseCase {
  static readonly key = 'incident.close'
  static readonly input = z.object({ id: z.string() })
  static readonly output = Incident.schema
  static readonly errors = {
    ...Incident.errors,
    NOT_FOUND: { message: 'Incident not found' },
  } as const
  static readonly ports = { incidents: IncidentRepository, clock: Clock }
  static readonly publishes = [DomainEvents] as const

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id)
    if (!incident) throw errors.NOT_FOUND()
    const closed = incident.close(ports.clock.now())
    await ports.incidents.save(closed)
    publish(new IncidentClosed({ id: closed.id, closedAt: closed.closedAt }))
    return closed.toProps()
  }
}
```

The entity owns the rule (`incident.close(now)`). The use case orchestrates.

## Boot an app

```ts
const app = App.from(useCases)
  .provide(IncidentRepository, repo)
  .provide(Clock, clock)
  .bind(DomainEvents, bus)
  .ctx<AppContext>({ requestId: 'boot' })
  .ctxFrom(({ request, ctx }) => ctx)
  .build()

await app.start()
await app.local.incident.close({ id: '1' })
await app.stop()
```

`build()` is not callable until every required port and catalog is provided — at compile time and at runtime.

Call `start()` before use cases that publish to catalogs with handlers.

HTTP: `POST /rpc/incident/close` with `{ input: { id: '1' } }`. Request context is `.ctx()` / `.ctxFrom(({ request, ctx }) => ctx)` — never `body.ctx`.

## Test

```ts
const app = App.test({ close: CloseIncident })
  .provide(IncidentRepository, InMemoryRepository.of(IncidentRepository, {
    keyBy: 'id',
    seed: [Incident.open('1', 'Seeded')],
  }))
  .provide(Clock, { now: () => new Date() })
  .bind(DomainEvents, InMemoryBus.create())
  .build()

await app.local.incident.close({ id: '1' })
expect(app.published).toHaveLength(1)
```

## Extend

Subclass + typed statics + interceptors. See `examples/extend`: authorize, request-scope, unit-of-work. First registered interceptor is outer — register authorize **before** unit of work.

## Examples

- [`examples/crud-app`](examples/crud-app) — golden path. Read `CloseIncident`.
- [`examples/extend`](examples/extend) — copy-paste interceptors.
- [`examples/app-template`](examples/app-template) — Astro client + empty hexok backend.
