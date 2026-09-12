---
title: App
description: Composition root. build() is callable when every required port, catalog, and channel is wired.
sidebar:
  order: 1
---

```ts
import {
  type AdapterFor,
  App,
  AppBuilder,
  type AppInstance,
  type ChannelGateway,
  type ChannelGateways,
  type NestedClient,
} from 'hexok/runtime'
```

`App.from(useCases)` returns an `AppBuilder`. `build()` returns an `AppInstance`.

## App.from

```ts
App.from(useCases: Bag): AppBuilder<Bag>
```

Start composition from a map of use-case classes. Each entry is checked by `CheckUseCase`.

## AppBuilder

| Method | Notes |
| --- | --- |
| `provide(token, impl)` | Register a port implementation. A second `provide` for the same token is a compile-time error and a runtime throw. |
| `bind(catalog, adapter)` | Bind an event adapter. Adapter `kind` must match the catalog. A second bind of the same catalog fails. Freezes the catalog. |
| `route(channel, adapter)` | Route a channel class to a presence adapter. The channel catalog must be a bus and still needs `bind`. |
| `ctx<C>(defaults?)` | Set the default request context for `local`, HTTP, and event handlers. Per-call `ctx` overrides it. |
| `ctxFrom(fn)` | Set HTTP request context from the `Request`. `body.ctx` is ignored. Call `.ctx<C>()` first so `ctx` is typed. |
| `adapt(factory, ...deps)` | `provide(factory.token, factory.create(...deps))`. |
| `use(middleware)` | Register middleware around external `execute` (`local` and HTTP) — not event handlers or nested `run`. |
| `intercept(interceptor)` | Register an interceptor. First registered is outer. Duplicate `key` throws. |
| `build` | Complete the graph. Incomplete builders expose `build` as the missing port/catalog/channel message (not callable). |

`AdapterFor<K>` is `BusAdapter` when `K` is `'bus'`, `QueueAdapter` when `K` is `'queue'`.

## AppInstance

| Member | Notes |
| --- | --- |
| `local` | In-process nested client. Same keys as `contract`. Call `local.incident.close(input, { ctx, signal }?)`. |
| `router.fetch` | `fetch` handler for `POST /rpc/...`. Event handlers still require `start()`. |
| `contract` | Nested API contract (`incident.close` → `contract.incident.close`). Event and internal use cases are omitted (`trigger !== 'external'`). |
| `rpc` | Nested RPC catalog (`rpc.incident.close.path`) plus flat `routes`. |
| `handlers` | Event use-case constructors grouped by catalog key then event key. They subscribe only after `start()`. |
| `channels` | Routed channel gateways keyed by catalog key. Routing starts on `start()`. |
| `publish(envelope)` | Publish an envelope to its bound adapter now. Throws if handlers exist for that event and `start()` has not run. |
| `start()` | Subscribe event handlers and start channel routing. Throws if called twice without `stop()`. |
| `stop()` | Stop channel and event adapters. Safe to call more than once. |

HTTP: `POST /rpc/incident/close` with `{ input: { id: '1' } }`. Request context is `.ctx()` / `.ctxFrom(({ request, ctx }) => ctx)` — not `body.ctx`.

`NestedClient<Bag, Ctx>` is the type of `local`. `ChannelGateway<C>` is `ChannelControl` plus `join(input, connection)`. `ChannelGateways<Routed>` is those gateways keyed by catalog key.

## Compile-time errors

These types appear as the type of `build` / `provide` / `bind` / `route` when the graph is incomplete or duplicated. They are not typically imported.

| Type | Compile-time message |
| --- | --- |
| `MissingMessages` | `hexok: unprovided port "…"` (use-case alias) / `unbound catalog "…"` / `unrouted channel "…"`. Missing ports also say `Call .provide(token, impl) before .build()`. |
| `DuplicatePortError` | `hexok: port already provided` |
| `DuplicateCatalogError` | `hexok: catalog "…" already bound` |
| `DuplicateChannelError` | `hexok: catalog "…" already routed` |
| `ChannelKindError` | `hexok: channel catalog "…" is kind "…". Channels require a bus catalog.` |

Runtime throws related sentences with the token or catalog key interpolated (`hexok: port "Clock" already provided`, `hexok: unprovided port "Clock" (used by …)`).

## Example

```ts
const app = App.from({ close: CloseIncident })
  .provide(IncidentRepository, repo)
  .provide(Clock, clock)
  .bind(DomainEvents, bus)
  .ctx<AppContext>({ requestId: 'boot' })
  .build()

await app.start()
await app.local.incident.close({ id: '1' })
await app.stop()
```

## Related

- [ExternalUseCase](/api/app/external-use-case/)
- [InternalUseCase](/api/app/internal-use-case/)
- [Interceptor](/api/runtime/interceptor/)
- [ApiMiddleware](/api/runtime/middleware/)
- [deriveRpc](/api/runtime/rpc/)
- [App.test](/api/testing/app/)
