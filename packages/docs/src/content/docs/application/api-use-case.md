---
title: ApiUseCase
description: Request/response use case. Declare static key, input, output, errors, ports.
sidebar:
  order: 1
---

`ApiUseCase` is a request/response use case. Declare static `key`, `input`, `output`, `errors`, `ports`. Optional `publishes` lists catalogs you may publish to. The runtime constructs the class; do not `new` it.

`execute` receives [ExecuteCtx](/application/execute-ctx/). Return the output shape. Throw via `errors.CODE()`. Entity methods throw themselves — do not unwrap them.

```ts
class CloseIncident extends ApiUseCase {
  static readonly key = 'incident.close'
  static readonly input = z.object({ id: z.string() })
  static readonly output = Incident.schema
  static readonly errors = {
    ...Incident.errors,
    NOT_FOUND: { message: 'Incident not found' },
  }
  static readonly ports = { incidents: IncidentRepository, clock: Clock }
  static readonly publishes = [DomainEvents] as const

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id)
    if (!incident) throw errors.NOT_FOUND()
    const closed = incident.close(ports.clock.now())
    await ports.incidents.save(closed)
    publish(new IncidentClosed({ id: closed.id, closedAt: closed.closedAt }))
    return closed.toProps()
  }
}
```

See also: [EventUseCase](/application/event-use-case/), [HTTP RPC](/runtime/http-rpc/).
