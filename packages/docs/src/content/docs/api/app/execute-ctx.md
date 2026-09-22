---
title: ExecuteCtx
description: ExecuteCtx for ExternalUseCase and InternalUseCase; EventCtx for EventUseCase.
sidebar:
  order: 4
---

```ts
import type {
  EventCtx,
  ExecuteCtx,
  Publish,
  PublishFor,
  Run,
} from 'hexok/app'
```

Execute context is what runtime passes into `execute`: validated input, bound ports, error factories, `publish`, and nested `run`. It is typed from the subclass statics. `ctx` defaults to `declare static context` on the class, otherwise `unknown`. Use cases destructure this bag. Event handlers get `EventCtx` (the envelope plus `attempt`), with the same `ctx` default.

## ExecuteCtx

Argument to `ExternalUseCase.execute` and `InternalUseCase.execute`.

| Field | Notes |
| --- | --- |
| `input` | Validated `static input`. |
| `ports` | Bound adapters from `static ports`. |
| `ctx` | Request context. `declare static context` on the class, else `unknown`. The second generic overrides. |
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

## declare static context

`ExecuteCtx<C>` and `EventCtx<C>` read `ctx` from `declare static context` (`ContextOf`). No declaration means `unknown`. The field is type-only — `CheckUseCase` does not require it, and Hexok does not ship `Admin` or `Public` context types. Declare it on an app base class next to [guards](/hexok/api/app/guards/).

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

The second generic still wins: `ExecuteCtx<typeof CreateApiKey, { notReal: number }>` types `ctx` as `{ notReal: number }`.

## EventCtx

Argument to `EventUseCase.execute`. Same `ports`, `ctx`, `errors`, `signal`, `publish`, `run`, `channels` as `ExecuteCtx`. `ctx` uses the same `declare static context` default.

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
