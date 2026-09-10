---
title: CodedError
description: Thrown by use-case error factories. HTTP status lives here, not on the entity.
sidebar:
  order: 2
---

`CodedError` is thrown by use-case error factories. It carries `code`, HTTP `status`, optional `message`, and optional `data`.

HTTP status lives on the error, not on the entity. The domain only knows the code.

```ts
throw new CodedError({
  code: 'NOT_FOUND',
  status: 404,
  message: 'Incident not found',
})
```

See also: [Error map](/core/error-map/), [Error factories](/application/error-factories/).
