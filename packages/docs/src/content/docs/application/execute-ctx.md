---
title: ExecuteCtx
description: Typed execute argument. input or event, ports, ctx, errors, signal, publish, run.
sidebar:
  order: 3
---

`ExecuteCtx<typeof UseCase>` is the argument to `ApiUseCase.execute`. `EventCtx` is the same idea for event handlers (`event` instead of `input`).

Fields: validated `input` (or `event` envelope), resolved `ports`, request `ctx`, `errors` factories, `signal`, typed `publish`, `run`, and `channels` (when the use case declared `static channels`). Queue handlers also get `attempt`.

```ts
async execute({ input, ports, errors, publish }: ExecuteCtx<typeof CloseIncident>) {
  const incident = await ports.incidents.get(input.id)
  if (!incident) throw errors.NOT_FOUND()
  publish(new IncidentClosed({ id: incident.id, closedAt: incident.closedAt }))
  return incident.toProps()
}
```

`run(UseCase, input)` calls another request/response use case on the **caller’s** publish queue. It re-validates input, resolves the child’s ports from the same provided map, and uses the child’s error factories. It does not flush, and does not re-enter interceptors or RPC middleware. Public and `internal: true` API use cases are both runnable. HTTP / `app.local` keep their own queue.

```ts
const user = await run(CreateUser, {
  ...input.user,
  organizationId: organization.props.id,
})
```

Child error codes are not merged onto the parent contract. Spread `...CreateUser.errors` if the HTTP surface should include them.

See also: [Request context](/runtime/request-context/), [Publish after success](/application/publish-after-success/).
