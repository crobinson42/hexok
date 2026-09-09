# Extension recipes

Copy these interceptors. They read **typed fields and interfaces**, never `meta` bags or Symbols.

## Order

First registered is **outer**. Register **authorize before unit of work** so a forbidden call never opens a transaction. That rule lives on `Interceptor` JSDoc and here — not folklore.

```ts
App.from(useCases)
  .intercept(new AuthorizeInterceptor())
  .intercept(new RequestScopeInterceptor())
  .intercept(new UnitOfWorkInterceptor())
```

## Authorize

`static policy = 'ledger:charge'` on the use case. Interceptor skips when absent. Requires `ctx.principal.roles` to include the policy or `'admin'`. Uses `errors.FORBIDDEN()` when declared.

## Request scope

Adapter `implements RequestScoped`. Interceptor `fork()`s per call. Two `local` calls do not share forked state.

## Unit of work

Adapter `implements Transactional`. Interceptor opens `{ onCommit, onRollback }`, `bindTo(uow)`, commit after `next()`, rollback on throw.

Publish flushes **after** the use-case onion, so a successful commit naturally yields after-commit publish. `aroundPublish` stamps `envelope.meta.afterCommit = true` so tests can observe it.
