---
title: Result
description: Success-or-code. validate and custom flows return this; use cases may unwrap it.
sidebar:
  order: 1
---

`Result<T, E>` is either `{ ok: true, value }` or `{ ok: false, code }`. `validate` returns it. Custom application flows may too. Entity methods throw [CodedError](/core/coded-error/) instead of returning a Result.

`ok` and `fail` collapse unused arms to `never`, so unions from if-branches stay tight.

```ts
const parsed = validate(schema, value)
// Result<Output, 'VALIDATION'>
```

See also: [unwrap](/application/unwrap/), [CodedError](/core/coded-error/).
