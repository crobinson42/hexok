---
title: Port
description: A TypeScript interface plus a token used at compose time.
sidebar:
  order: 3
---

A port is a TypeScript interface plus a token used at compose time. The interface is what use cases call. The token is what `App.provide` binds.

```ts
export interface IncidentRepository {
  get(id: string): Promise<Incident | null>
  save(incident: Incident): Promise<void>
}
export const IncidentRepository = Port.token<IncidentRepository>(
  'IncidentRepository',
)
```

`.build()` names a missing port by its use-case alias (`ports: { incidents: IncidentRepository }` → `"incidents"`).

See also: [Adapter](/infrastructure/adapter/), [App.from](/runtime/app-from/).
