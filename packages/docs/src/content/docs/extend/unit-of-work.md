---
title: Unit of work
description: Opens onCommit/onRollback, bindTo(uow), commit after next(), rollback on throw.
sidebar:
  order: 3
---

The unit-of-work interceptor opens `{ onCommit, onRollback }`, calls `bindTo(uow)` on [Transactional](/domain/transactional/) ports, commits after `next()`, and rolls back on throw.

Publish flushes **after** the use-case onion, so a successful commit naturally yields after-commit publish. The example stamps `envelope.meta.afterCommit = true` in `aroundPublish` so tests can observe it.

Register **authorize before** this interceptor.

```ts
const result = await next({ ...ctx, ports })
await uow.commit()
return result
```

See also: [UnitOfWork](/domain/unit-of-work/), [Publish after success](/application/publish-after-success/).
