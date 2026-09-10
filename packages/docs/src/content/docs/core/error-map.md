---
title: Error map
description: Declared error codes. Keys of an ErrorMap are the error union.
sidebar:
  order: 3
---

An `ErrorMap` is a record of `ErrorDef`s: optional `message` and `data` schema. **The keys are the error union.** Object-literal keys are already literal — do not annotate the object as `ErrorMap`, or keys widen to `string`. `as const` and `satisfies ErrorMap` are optional.

Entities declare domain codes. Use cases spread them and add orchestration codes like `NOT_FOUND`.

```ts
const errors = {
  NOT_FOUND: { message: 'Incident not found' },
}
```

See also: [Error factories](/application/error-factories/), [CodedError](/core/coded-error/), [HTTP RPC](/runtime/http-rpc/).
