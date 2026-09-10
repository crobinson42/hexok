---
title: ExecuteCtx
description: Typed execute argument. input or event, ports, ctx, errors, signal, publish.
sidebar:
  order: 3
---

`ExecuteCtx<typeof UseCase>` is the argument to `ApiUseCase.execute`. `EventCtx` is the same idea for event handlers (`event` instead of `input`).

Fields: validated `input` (or `event` envelope), resolved `ports`, request `ctx`, `errors` factories, `signal`, and typed `publish`. Broker handlers also get `attempt`.

```ts
async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
  const incident = await ports.incidents.get(input.id)
  if (!incident) throw errors.NOT_FOUND()
  publish(new IncidentClosed({ id: incident.id, closedAt: incident.closedAt }))
  return incident.toProps()
}
```

See also: [Request context](/runtime/request-context/), [Publish after success](/application/publish-after-success/).
