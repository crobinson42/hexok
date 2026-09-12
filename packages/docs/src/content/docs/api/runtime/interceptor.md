---
title: Interceptor
description: Extension seam around execute, adapters, publish, and dispatch.
sidebar:
  order: 2
---

```ts
import {
  type Handler,
  type HandlerCtx,
  type Interceptor,
  requireCapability,
} from 'hexok/runtime'
```

Register with [`App.intercept`](/api/runtime/app/). First registered is **outer** for execute, adapter, publish, and dispatch. Duplicate `key` throws.

## Interceptor

| Member | Notes |
| --- | --- |
| `key` | Unique registration id. |
| `aroundUseCase?(uc, next)` | Wrap API and event `execute`. Nested `run` does not re-enter this hook. |
| `aroundAdapter?(port, impl)` | Wrap a provided port impl once at `build`. |
| `aroundPublish?(envelope, next)` | Wrap catalog publish after execute returns. Swallowing `next()` drops the event. |
| `aroundDispatch?(envelope, uc, next)` | Wrap one event-handler invocation. API use cases never call this hook. |

Publish flushes after the use-case onion.

## HandlerCtx / Handler

`Handler` is `(ctx: HandlerCtx) => Promise<unknown>`.

| Field | Notes |
| --- | --- |
| `ports` | Port impls aliased as the use case declared them. |
| `ctx` | Request context from `.ctx()` or a per-call override. |
| `errors` | Error factories from the use-case error map. |
| `signal` | Abort signal for this invocation. |
| `publish(event)` | Enqueue an event. Flushed only if `execute` returns. |
| `run?(useCase, input)` | Invoke another API use case without re-entering interceptors or RPC middleware. |
| `input?` | Parsed API input. Absent on event handlers. |
| `event?` | Envelope for event handlers. Absent on API use cases. |
| `attempt?` | Queue delivery attempt. Set only for queue handlers. |

```ts
class LogInterceptor implements Interceptor {
  readonly key = 'log'
  aroundUseCase(uc, next) {
    return async (ctx) => {
      console.log(uc.key)
      return next(ctx)
    }
  }
}

App.from(useCases).intercept(new LogInterceptor())
```

## requireCapability

```ts
requireCapability(
  token: PortToken<unknown>,
  impl: unknown,
  method: 'bindTo' | 'fork',
  label: 'Transactional' | 'RequestScoped',
): void
```

Throw if a port impl is missing `bindTo` / `fork`. `provide()` calls this when the token flags the capability.

## Related

- [App.intercept](/api/runtime/app/)
- [ApiMiddleware](/api/runtime/middleware/)
- [Port](/api/domain/port/)
