---
title: unwrap
description: "Same one-liner as if (!result.ok) throw this.error(result.code)."
sidebar:
  order: 5
---

`unwrap` is the same one-liner as `if (!result.ok) throw this.error(result.code)`. Domain methods return [Result](/core/result/). Use cases unwrap.

```ts
const closed = this.unwrap(incident.close(now))
await ports.incidents.save(closed)
```

See also: [ApiUseCase](/application/api-use-case/), [Error factories](/application/error-factories/).
