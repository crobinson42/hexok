---
title: Hexok
description: A TypeScript kit for writing a clean-architecture backend as ordinary classes.
---

A TypeScript kit for writing a clean-architecture backend as ordinary classes.

## Install

```bash
npm i hexok
```

Import from a layer. There is no root barrel.

```ts
import { Entity } from 'hexok/domain'
import { ApiUseCase } from 'hexok/app'
import { App } from 'hexok/runtime'
import { App as TestApp, InMemoryRepository } from 'hexok/testing'
```

| Import | Exports |
| --- | --- |
| [`hexok/core`](/api/core/coded-error/) | `Result`, Standard Schema V1, `ErrorMap`, `CodedError` |
| [`hexok/domain`](/api/domain/entity/) | `Entity`, `Port`, `EventCatalog`, `DomainEvent` |
| [`hexok/app`](/api/app/api-use-case/) | `ApiUseCase`, `EventUseCase`, `EventChannel`, contract derivation |
| [`hexok/infra`](/api/infra/mapper/) | `Mapper`, `Adapter.of` |
| [`hexok/runtime`](/api/runtime/app/) | `App.from`, completeness, interceptors, local client, HTTP |
| [`hexok/testing`](/api/testing/app/) | `App.test`, in-memory repo/bus/queue/channel, `published` |
