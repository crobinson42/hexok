---
title: Result
description: Success-or-code. Domain methods return this; use cases unwrap it.
sidebar:
  order: 1
---

`Result<T, E>` is either `{ ok: true, value }` or `{ ok: false, code }`. Domain methods return it. Use cases unwrap it into a value or a thrown error.

`ok` and `fail` collapse unused arms to `never`, so unions from if-branches stay tight.

```ts
const closed =
  status === 'closed' ? fail('ALREADY_CLOSED') : ok(next)
// Result<Next, 'ALREADY_CLOSED'>
```

See also: [unwrap](/application/unwrap/), [CodedError](/core/coded-error/).
