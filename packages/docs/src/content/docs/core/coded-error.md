---
title: CodedError
description: Thrown by entities and use-case error factories. Carries code, message, and data.
sidebar:
  order: 2
---

`CodedError` is thrown by entity refusals and use-case error factories. It carries `code`, optional `message`, and optional `data`.

```ts
throw new CodedError({
  code: 'NOT_FOUND',
  message: 'Incident not found',
})
```

See also: [Error map](/core/error-map/), [Error factories](/application/error-factories/), [HTTP RPC](/runtime/http-rpc/).
