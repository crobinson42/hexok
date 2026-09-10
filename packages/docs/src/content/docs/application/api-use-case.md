---
title: ApiUseCase
description: HTTP/RPC use case. Declare static key, input, output, errors, ports.
sidebar:
  order: 1
---

`ApiUseCase` is an HTTP/RPC use case. Declare static `key`, `input`, `output`, `errors`, `ports`. Optional `publishes` lists catalogs you may publish to.

`execute` receives [ExecuteCtx](/application/execute-ctx/). Return the output shape. Throw via `errors.CODE()`.

```ts
class CloseIncident extends ApiUseCase {
  static readonly key = 'incident.close'
  static readonly input = z.object({ id: z.string() })
  static readonly output = Incident.schema
  static readonly errors = {
    ...Incident.errors,
    NOT_FOUND: { status: 404, message: 'Incident not found' },
  }
  static readonly ports = { incidents: IncidentRepository, clock: Clock }
  static readonly publishes = [DomainEvents] as const

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id)
    if (!incident) throw errors.NOT_FOUND()
    const closed = incident.close(ports.clock.now())
    if (!closed.ok) throw errors[closed.code]()
    await ports.incidents.save(closed.value)
    publish(new IncidentClosed({ id: closed.value.id, closedAt: closed.value.closedAt }))
    return closed.value.toProps()
  }
}
```

See also: [EventUseCase](/application/event-use-case/), [HTTP RPC](/runtime/http-rpc/).
