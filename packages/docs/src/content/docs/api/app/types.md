---
title: Types
description: Constructor shapes, guards, and error factories for use cases.
sidebar:
  order: 6
---

```ts
import {
  type ApiUseCaseCtor,
  type AsUseCaseBag,
  type CheckUseCase,
  type ErrorFactories,
  errorFactories,
  type EventChannelCtor,
  type EventUseCaseCtor,
  isApiUseCase,
  isEventUseCase,
  type ResolvedPorts,
  type UseCaseBag,
  type UseCaseClass,
} from 'hexok/app'
```

## Guards

| Name | Notes |
| --- | --- |
| `isApiUseCase(ctor)` | True when `ctor.trigger === 'api'`. |
| `isEventUseCase(ctor)` | True when `ctor.trigger === 'event'`. |

## Constructor shapes

| Name | Notes |
| --- | --- |
| `ApiUseCaseCtor` | Constructor shape of an `ApiUseCase` subclass. |
| `EventUseCaseCtor` | Constructor shape of an `EventUseCase` subclass. |
| `EventChannelCtor` | Constructor shape of an `EventChannel` subclass. |
| `UseCaseClass` | `ApiUseCaseCtor \| EventUseCaseCtor` |
| `UseCaseBag` | `Record<string, UseCaseClass>` passed to `App.from`. |
| `AsUseCaseBag<Bag>` | Keep a checked bag's specific classes. |
| `CheckUseCase<C>` | Per-entry diagnostic for `App.from` / `App.test`. Missing statics become a `hexok:` sentence. |

## Ports and errors

| Name | Notes |
| --- | --- |
| `ResolvedPorts<P>` | Port map with tokens replaced by their bound implementations. |
| `ErrorFactories<M>` | `errors.CODE()` map. Each factory throws `CodedError` and types as `never`. |
| `errorFactories(map)` | Build that map from an `ErrorMap`. |

When `ErrorDef.data` is set, the factory is `(data: Infer<S>) => never` and validates `data` with that schema.

```ts
const errors = errorFactories({
  NOT_FOUND: { message: 'Incident not found' },
})
throw errors.NOT_FOUND()
```

## Related

- [ApiUseCase](/api/app/api-use-case/)
- [EventUseCase](/api/app/event-use-case/)
- [EventChannel](/api/app/event-channel/)
- [ErrorMap](/api/core/errors/)
