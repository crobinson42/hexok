---
title: unwrap
description: "Same one-liner as if (!result.ok) throw this.error(result.code)."
sidebar:
  order: 5
---

`unwrap` is the same one-liner as `if (!result.ok) throw this.error(result.code)`. Use it for [Result](/core/result/) from `validate` or custom flows. Entity methods throw [CodedError](/core/coded-error/) themselves — do not unwrap them.

```ts
const parsed = this.unwrap(validate(schema, raw))
```

See also: [ApiUseCase](/application/api-use-case/), [Error factories](/application/error-factories/).
