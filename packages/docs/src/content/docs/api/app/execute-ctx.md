---
title: ExecuteCtx
description: Typed argument to ApiUseCase.execute and EventUseCase.execute.
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

Typed from the subclass statics.

## ExecuteCtx

Argument to `ApiUseCase.execute`.

| Field | Notes |
| --- | --- |
| `input` | Validated `static input`. |
| `ports` | Bound adapters from `static ports`. |
| `ctx` | App request context from `App.ctx` or the caller. |
| `errors` | Factories from `static errors`. Throw `errors.NOT_FOUND()`. |
| `signal` | Abort signal for this invocation. |
| `publish` | Enqueue a catalog event. Flushed only if `execute` returns. |
| `run` | Invoke another API use case with the same ctx, signal, and publish queue. Nested `run` does not re-enter interceptors or RPC middleware. |
| `channels` | Presence handles for `static channels`, keyed by catalog key. |

```ts
async execute({ input, ports, errors }: ExecuteCtx<typeof CloseIncident>) {
  const incident = await ports.incidents.get(input.id)
  if (!incident) throw errors.NOT_FOUND()
  return incident.toProps()
}
```

## EventCtx

Argument to `EventUseCase.execute`. Same `ports`, `ctx`, `errors`, `signal`, `publish`, `run`, `channels` as `ExecuteCtx`.

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
| `Run` | `<U extends ApiUseCaseCtor>(useCase: U, input: Infer<U['input']>) => Promise<Infer<U['output']>>` |

A throw from `execute` drops the publish queue.

## Related

- [ApiUseCase](/api/app/api-use-case/)
- [EventUseCase](/api/app/event-use-case/)
- [Envelope](/api/domain/envelope/)
- [ChannelControl](/api/app/event-channel/)
