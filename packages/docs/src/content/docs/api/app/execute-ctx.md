---
title: ExecuteCtx
description: ExecuteCtx for ExternalUseCase and InternalUseCase; EventCtx for EventUseCase.
sidebar:
  order: 4
---

```ts
import {
  defineGuard,
  type EventCtx,
  type ExecuteCtx,
  type Publish,
  type PublishFor,
  type Run,
} from 'hexok/app'
```

Execute context is what runtime passes into `execute`: validated input, bound ports, error factories, `publish`, and nested `run`. It is typed from the subclass statics. `ExecuteCtx<C>` and `EventCtx<C>` take one type argument. `ctx` is `declare static context` when it matches the last branded guard `OutCtx`, else that `OutCtx`, else `unknown`. Use cases destructure this bag. Event handlers get `EventCtx` (the envelope plus `attempt`), with the same `ctx` default.

## ExecuteCtx

Argument to `ExternalUseCase.execute` and `InternalUseCase.execute`.

| Field | Notes |
| --- | --- |
| `input` | Validated `static input`. |
| `ports` | Bound adapters from `static ports`. |
| `ctx` | Post-guard request context. `declare static context` when it matches the last `defineGuard` `OutCtx`, else that `OutCtx`, else `unknown`. See [ctx](#ctx). |
| `errors` | Factories from `static errors`. Throw `errors.NOT_FOUND()`. |
| `signal` | Abort signal for this invocation. |
| `publish` | Enqueue a catalog event. Flushed only if `execute` returns. |
| `run` | Invoke an ExternalUseCase or InternalUseCase with the same ctx, signal, and publish queue. Nested `run` does not re-enter guards, interceptors, or `App.use`. |
| `channels` | Presence handles for `static channels`, keyed by catalog key. |

```ts
async execute({ input, ports, errors }: ExecuteCtx<typeof CloseIncident>) {
  const incident = await ports.incidents.get(input.id)
  if (!incident) throw errors.NOT_FOUND()
  return incident.toProps()
}
```

## ctx

`ExecuteCtx<C>` and `EventCtx<C>` take one type argument. `ctx` is the post-guard type: looking at `static guards` plus `ExecuteCtx<typeof ThisClass>` is enough. Inbound context (`App.ctx<C>()` / per-call `{ ctx }`) may differ. `CheckUseCase` does not require `declare static context`, and Hexok does not ship `Admin` or `Public` context types. Declare it on an app base class next to [guards](/hexok/api/app/guards/).

```ts
export abstract class UserUseCase extends ExternalUseCase {
  static readonly guards = [authenticated] as const
  declare static context: { actor: { id: string } }
}

class CreateApiKey extends UserUseCase {
  async execute({ ctx }: ExecuteCtx<typeof CreateApiKey>) {
    ctx.actor.id
  }
}
```

If `declare static context` is omitted, `ctx` is the last `defineGuard` `OutCtx`. `defineGuard<InCtx, OutCtx>(guard)` brands the gate so the chain can see `OutCtx`. An empty list or an object literal does not narrow, so `ctx` stays `unknown`. Unbranded guards are skipped; they do not reset an earlier `OutCtx`.

The walk starts at `declare static context`, or `unknown`. Each branded `InCtx` must accept the context so far, and the next context is that guard's `OutCtx`. When it does not, `ctx` is `` `hexok: "${key}" guard InCtx does not accept accumulated ctx` ``. That string is not a `CheckUseCase` error.

When `declare static context` is present, it must be mutually assignable with the final walked type. Then `ctx` is that type. If they disagree, `ctx` is `` `hexok: "${key}" declared context does not match guard OutCtx` ``.

`.ctx<C>()` is inbound. At `build`, that `C` must be assignable to each branded guard `InCtx` (unbranded guards do not force anything). On failure `build` is `` `hexok: "${key}" app context is not assignable to guard InCtx` ``, not a function. `unknown` (no `.ctx<C>()`) is assignable only to an `In` of `unknown`.

## EventCtx

Argument to `EventUseCase.execute`. Same `ports`, `ctx`, `errors`, `signal`, `publish`, `run`, `channels` as `ExecuteCtx`. `ctx` uses the same single-argument default.

| Field | Notes |
| --- | --- |
| `event` | Envelope for `static on`, including payload and catalog metadata. |
| `attempt` | 1-based delivery attempt. Present for queue catalogs; optional for bus. |

```ts
async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
  await ports.notifier.send(event.payload)
}
```

## Publish, PublishFor, Run

| Name | Notes |
| --- | --- |
| `Publish` | `(event: DomainEvent) => void` or `(envelope: Envelope) => void`. |
| `PublishFor<C>` | `publish` when `static publishes` is declared — only those catalog events. |
| `Run` | `<U extends CallableUseCaseCtor>(useCase: U, input: Infer<U['input']>) => Promise<Infer<U['output']>>` |

A throw from `execute` drops the publish queue.

## Related

- [Guard](/hexok/api/app/guards/)
- [ExternalUseCase](/hexok/api/app/external-use-case/)
- [InternalUseCase](/hexok/api/app/internal-use-case/)
- [EventUseCase](/hexok/api/app/event-use-case/)
- [Envelope](/hexok/api/domain/envelope/)
- [ChannelControl](/hexok/api/app/event-channel/)
