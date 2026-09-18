# hexok

Hexo Kit — a TypeScript kit for writing a clean-architecture backend as ordinary classes: Entity, Port, Adapter, UseCase, Event, Interceptor.

**Docs:** https://crobinson42.github.io/hexok/

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

| Import | What it is |
| --- | --- |
| `hexok/core` | `Result`, Standard Schema V1, `ErrorMap`, `CodedError` |
| `hexok/domain` | `Entity`, `Port`, `EventCatalog`, `DomainEvent` |
| `hexok/app` | `ExternalUseCase`, `InternalUseCase`, `EventUseCase`, `EventChannel` |
| `hexok/infra` | `Mapper`, `Adapter.of` |
| `hexok/runtime` | `App.from`, interceptors, local client, HTTP |
| `hexok/testing` | `App.test`, in-memory adapters |

Full API: https://crobinson42.github.io/hexok/
