---
title: Error factories
description: errors.NOT_FOUND() throws a CodedError. Keys come from the use-case error map.
sidebar:
  order: 4
---

`errorFactories` turns the use-case `errors` map into `errors.NOT_FOUND()` functions. Each factory throws a [CodedError](/core/coded-error/) and types as `never`.

If an `ErrorDef` has a `data` schema, the factory takes that payload.

```ts
if (!incident) throw errors.NOT_FOUND()
if (!closed.ok) throw errors[closed.code]()
```

See also: [Error map](/core/error-map/), [unwrap](/application/unwrap/).
