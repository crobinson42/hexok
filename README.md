# Plinth

A TypeScript kit for writing a clean-architecture backend as **ordinary classes**: Entity, Port, Adapter, UseCase, Event, Interceptor.

A new hire should open a use-case file and understand the business flow without a glossary of hidden methods, phantom fields, or `meta` bags.

## Install

```bash
npm i plinth
```

Import from a layer. There is no root barrel — that keeps the public API aligned with the architecture.

```ts
import { Entity } from 'plinth/domain'
import { ApiUseCase } from 'plinth/app'
import { App } from 'plinth/runtime'
import { App as TestApp, InMemoryRepository } from 'plinth/testing'
```

| Import | What it is |
| --- | --- |
| `plinth/core` | `Result`, Standard Schema V1, `ErrorMap` |
| `plinth/domain` | `Entity`, `TrackedEntity`, `Port`, `EventCatalog`, `DomainEvent` |
| `plinth/app` | `ApiUseCase`, `EventUseCase`, contract derivation |
| `plinth/infra` | `Mapper` (entity ↔ row), `Adapter.of` |
| `plinth/runtime` | `App.from` composition, completeness, interceptors, local client, HTTP |
| `plinth/testing` | Test-only: `App.test`, in-memory repo/bus/broker, `published` |

Concept docs: `npm run dev -w @plinth/docs`.

## Write a use case

```ts
class CloseIncident extends ApiUseCase {
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
  .build()

await app.local.incident.close({ id: '1' })
await app.start() // event handlers do not run until start()
await app.stop()
```

`build()` is not callable until every required port and catalog is provided — at compile time and at runtime.

HTTP: `POST /rpc/incident/close` with `{ input: { id: '1' } }`.

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
- [`examples/app-template`](examples/app-template) — Astro client + empty plinth backend.
