---
title: Completeness
description: Incomplete builders expose build as the missing port or catalog message, not a callable.
sidebar:
  order: 2
---

Completeness is the point of `AppBuilder`. Until every required port, catalog, and routed channel is provided, `build` is a string (a `hexok:` sentence), not a function.

The same sentences throw at runtime if you bypass the type. Duplicate tokens and catalogs also error.

```ts
// Unprovided port "IncidentRepository" (used by incident.close)
// Unbound catalog "domain" (used by incident.close)
```

Use-case statics are checked too: missing `ports` / `on` / `catalog` become sentences instead of a union dump.

See also: [App.from](/runtime/app-from/), [Port](/domain/port/).
