---
title: Types
description: Constructor shapes, guards, and error factories for use cases.
sidebar:
  order: 6
---

```ts
import {
  type AsUseCaseBag,
  type CallableUseCaseCtor,
  type CheckUseCase,
  type ErrorFactories,
  errorFactories,
  type EventChannelCtor,
  type EventUseCaseCtor,
  type ExternalUseCaseCtor,
  type InternalUseCaseCtor,
  isCallableUseCase,
  isEventUseCase,
  isExternalUseCase,
  isInternalUseCase,
  type ResolvedPorts,
  type UseCaseBag,
  type UseCaseClass,
} from 'hexok/app'
```

## Guards

| Name | Notes |
| --- | --- |
| `isExternalUseCase(ctor)` | True when `ctor.trigger === 'external'`. |
| `isInternalUseCase(ctor)` | True when `ctor.trigger === 'internal'`. |
| `isCallableUseCase(ctor)` | True when `ctor.trigger` is `'external'` or `'internal'`. |
| `isEventUseCase(ctor)` | True when `ctor.trigger === 'event'`. |

## Constructor shapes

| Name | Notes |
| --- | --- |
| `CallableUseCaseCtor` | Constructor shape of an ExternalUseCase or InternalUseCase subclass. |
| `ExternalUseCaseCtor` | Constructor shape of an `ExternalUseCase` subclass. |
| `InternalUseCaseCtor` | Constructor shape of an `InternalUseCase` subclass. |
| `EventUseCaseCtor` | Constructor shape of an `EventUseCase` subclass. |
| `EventChannelCtor` | Constructor shape of an `EventChannel` subclass. |
| `UseCaseClass` | `ExternalUseCaseCtor \| InternalUseCaseCtor \| EventUseCaseCtor` |
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

- [ExternalUseCase](/api/app/external-use-case/)
- [InternalUseCase](/api/app/internal-use-case/)
- [EventUseCase](/api/app/event-use-case/)
- [EventChannel](/api/app/event-channel/)
- [ErrorMap](/api/core/errors/)
