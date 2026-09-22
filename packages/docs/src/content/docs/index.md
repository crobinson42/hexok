---
title: Hexok
description: A TypeScript kit for writing a clean-architecture backend as ordinary classes.
---

A TypeScript kit for writing a clean-architecture backend as ordinary classes.

Hexok follows hexagonal / onion architecture, split by import path:

- **domain** — entities, ports, and events. The inside of the hexagon. No I/O.
- **app** — use cases that orchestrate through ports.
- **infra** — adapters and mappers that implement ports.
- **runtime** — composition root (`App.from`), interceptors, local client, HTTP.
- **core** — shared primitives: `Result`, schemas, coded errors.
- **testing** — the same graph, with in-memory fakes.

The entity owns the rule. The use case orchestrates. Import from a layer; there is no root barrel.

## Install

```bash
npm i hexok
```

Import from a layer. There is no root barrel.

```ts
import { Entity } from 'hexok/domain'
import { ExternalUseCase } from 'hexok/app'
import { App } from 'hexok/runtime'
import { App as TestApp, InMemoryRepository } from 'hexok/testing'
```

| Import | Exports |
| --- | --- |
| [`hexok/core`](/hexok/api/core/coded-error/) | `Result`, Standard Schema V1, `ErrorMap`, `CodedError` |
| [`hexok/domain`](/hexok/api/domain/entity/) | `Entity`, `Port`, `EventCatalog`, `DomainEvent` |
| [`hexok/app`](/hexok/api/app/external-use-case/) | `ExternalUseCase`, `InternalUseCase`, `EventUseCase`, `Guard`, `EventChannel`, contract derivation |
| [`hexok/infra`](/hexok/api/infra/mapper/) | `Mapper`, `Adapter.of` |
| [`hexok/runtime`](/hexok/api/runtime/app/) | `App.from`, completeness, interceptors, local client, HTTP |
| [`hexok/testing`](/hexok/api/testing/app/) | `App.test`, in-memory repo/bus/queue/channel, `published` |
