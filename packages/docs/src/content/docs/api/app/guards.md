---
title: Guard
description: Identity gate on a use case. Empty list is public; omitting it fails closed.
sidebar:
  order: 8
---

```ts
import type { Guard, GuardArgs } from 'hexok/app'
```

A guard is who may enter a use case, declared on the class as `static readonly guards`. Hexok runs that list after request context is built and before input validation, middleware, and interceptors. Every [ExternalUseCase](/hexok/api/app/external-use-case/) must declare it. An [EventUseCase](/hexok/api/app/event-use-case/) may. Use a guard for identity or permission — not for loading a row, opening a transaction, or logging. Empty `[] as const` is public. Omitting the field fails closed. Hexok does not ship roles, tokens, or `PublicUseCase`; the app writes the objects.

## Guard

Throw a [`CodedError`](/hexok/api/core/coded-error/) to refuse. Return to allow. Do not return a boolean — Hexok does not map `false` to 403. [`httpStatus`](/hexok/api/runtime/http-status/) already maps `UNAUTHORIZED` to 401 and `FORBIDDEN` to 403.

| Member | Notes |
| --- | --- |
| `key` | Stable id. The same key on different use cases is fine. |
| `allow(args)` | `void \| Promise<void>`. No ports, no input, no `Request`. |

`GuardArgs`:

| Field | Notes |
| --- | --- |
| `ctor` | Leaf constructor (`Charge`), not an app base class. |
| `ctx` | Read-only request context. The same object later passed to `execute`. |
| `errors` | Factories from `static errors`. Prefer `errors.UNAUTHORIZED()` / `errors.FORBIDDEN()`. |

```ts
import type { Guard } from 'hexok/app'
import { CodedError } from 'hexok/core'

export const authenticated: Guard = {
  key: 'authenticated',
  allow({ ctx, errors }) {
    if ((ctx as { actor?: unknown }).actor) return
    if (typeof errors.UNAUTHORIZED === 'function') errors.UNAUTHORIZED()
    throw new CodedError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  },
}
```

I/O stays in `execute` or an [interceptor](/hexok/api/runtime/interceptor/). Row rules (this actor owns `input.userId`, often after load) stay in `execute`. Headers stay in `ctxFrom`. That keeps `app.local` and HTTP on the same gate.

Parameterized factories are an app pattern, like [`Adapter.of`](/hexok/api/infra/adapter/). Hexok does not ship `Roles`.

```ts
export const Roles = {
  of(role: string): Guard {
    return {
      key: `role:${role}`,
      allow({ ctx, errors }) {
        /* app-owned check; throw errors.FORBIDDEN() to refuse */
      },
    }
  },
}
```

## static guards

Same family as `ports`, `publishes`, and `channels`. The field is optional on the base class and has no initializer, so a subclass that forgets it does not inherit a public array.

| Spelling | Result |
| --- | --- |
| `static readonly guards = [] as const` | Public. |
| Field omitted | Fail closed. |
| Wide array, no `as const` | `CheckUseCase` diagnostic only: `` hexok: ExternalUseCase "…" static guards must be `as const` ``. `build()` does not throw this. |

Omitting `guards` fails closed. `CheckUseCase` reports it, and `build()` and invoke throw `hexok: ExternalUseCase "…" is missing static guards`.

A duplicate `key` on one class throws `hexok: … duplicate guard key "…"` at `build()` and again at invoke.

A subclass **replaces** the list. Hexok does not merge parent and child (same as `ports`). Spread to extend: `static readonly guards = [...UserUseCase.guards, extra] as const`.

[InternalUseCase](/hexok/api/app/internal-use-case/) has no `guards` on its contract.

### App subclasses (not shipped)

`PublicUseCase`, `UserUseCase`, and `AdminUseCase` are app sugar over the list. Hexok does not export them.

```ts
export abstract class PublicUseCase extends ExternalUseCase {
  static readonly guards = [] as const
}

export abstract class UserUseCase extends ExternalUseCase {
  static readonly guards = [authenticated] as const
  declare static context: AppContext & { actor: Actor }
}
```

`declare static context` is type-only. It types [`ExecuteCtx`](/hexok/api/app/execute-ctx/) `ctx`. `AppContext` and `Actor` are app types. `CheckUseCase` does not require the declaration.

## Pipeline

HTTP and `app.local`:

**ctx → guards → validate → middleware (outer) → interceptors → execute**

1. **ctx** — HTTP uses `ctxFrom`. `app.local` uses per-call `{ ctx }` or the `App.ctx()` default. `ctxFrom` does not receive the use-case constructor.
2. **guards** — `allow` in order. The first throw wins. A refusal does not see `VALIDATION` and does not enter an interceptor, so a forbidden call does not open a transaction.
3. **validate** — `static input`.
4. **middleware** — [`App.use`](/hexok/api/runtime/app/). Outer.
5. **interceptors** — [`App.intercept`](/hexok/api/runtime/app/). Inner: unit of work, request scope, logging.
6. **execute**.

The runtime wraps interceptors (`wrapUseCase`) and then middleware (`wrapMiddleware`), so middleware stays outside the interceptors. Do not reverse those calls, and do not rely on interceptor registration order to run identity before a transaction.

Nested [`run()`](/hexok/api/app/execute-ctx/) skips guards, middleware, and interceptors. It inherits the outer ctx. Prefer an `InternalUseCase` for shared steps. A public parent that `run`s a tighter external use case does not re-check that child.

## Four seams

| Seam | Where | Question |
| --- | --- | --- |
| `ctxFrom` | `AppBuilder.ctxFrom` | Who is this HTTP caller? Builds ctx from the `Request`. Ignores `body.ctx`. |
| Guard | `static guards` | May this actor enter this use case? Sees `ctor`, `ctx`, and error factories. |
| Middleware / interceptor | `App.use` / `App.intercept` | Work after the gate: unit of work, request scope, logging. Middleware is outer. |
| `execute` | Use-case class | Resource / row rules, often after a load. |

## Read-only ctx

Do not assign `ctx.actor` inside `allow`. Identity comes from `ctxFrom` or per-call `{ ctx }`, not from writing the context. `app.local` without `{ ctx }` passes the app-wide default, so a write leaks into later calls. Guards have no ctx out-param. Middleware `next()` cannot replace ctx either. Refuse with `errors.UNAUTHORIZED()` or `errors.FORBIDDEN()`.

## Events

On an event handler the list is optional. Omit it, or set `[] as const`, and the handler runs. When the list is present, ctx is only `App.ctx()` / `defaultCtx` — never `ctxFrom`, never the envelope. `app.start()` does not pass `{ ctx }`. `invokeEvent` is not a public per-call API. An HTTP-identity guard such as `authenticated` on an `EventUseCase` is almost always wrong: an empty default context refuses every delivery.

## No global

There is no `App.guard()`. A global prepend needs a skip list. The class list is the source of truth: public is `[] as const`, not an opt-out.

## Related

- [ExternalUseCase](/hexok/api/app/external-use-case/)
- [EventUseCase](/hexok/api/app/event-use-case/)
- [InternalUseCase](/hexok/api/app/internal-use-case/)
- [ExecuteCtx](/hexok/api/app/execute-ctx/)
- [Interceptor](/hexok/api/runtime/interceptor/)
- [App](/hexok/api/runtime/app/)
- [CodedError](/hexok/api/core/coded-error/)
