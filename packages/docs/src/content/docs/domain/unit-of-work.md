---
title: UnitOfWork
description: Commit and rollback hooks. Intersect capabilities with a port interface.
sidebar:
  order: 10
---

`UnitOfWork` is `{ onCommit, onRollback }`. It is an optional adapter **capability**, not a hidden Symbol. Intersect it with a port interface when an interceptor needs a transaction.

Missing methods fail at **build** with a sentence, not a lookup.

```ts
interface UnitOfWork {
  onCommit(fn: () => void | Promise<void>): void
  onRollback(fn: () => void | Promise<void>): void
}
```

See also: [Transactional](/domain/transactional/), [Unit of work interceptor](/extend/unit-of-work/).
