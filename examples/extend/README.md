# Extension recipes

Copy these interceptors. They read **typed fields and interfaces**, never `meta` bags or Symbols.

## Order

Guards run before interceptors, so a forbidden call never opens a transaction. First registered interceptor is **outer**.

```ts
App.from(useCases)
  .intercept(new RequestScopeInterceptor())
  .intercept(new UnitOfWorkInterceptor())
```

## Guards

`static readonly guards = [Roles.of('ledger:charge')] as const` on the use case. `Roles.of` requires `ctx.principal.roles` to include the role or `'admin'`. Throws `errors.FORBIDDEN()` when declared, otherwise `CodedError` `FORBIDDEN`. The use case lists the guard — missing policy is not a skip.

## Request scope

Adapter `implements RequestScoped`. Interceptor `fork()`s per call. Two `local` calls do not share forked state.

## Unit of work

Adapter `implements Transactional`. Interceptor opens `{ onCommit, onRollback }`, `bindTo(uow)`, commit after `next()`, rollback on throw.

Publish flushes **after** the use-case onion, so a successful commit naturally yields after-commit publish. `aroundPublish` stamps `envelope.meta.afterCommit = true` so tests can observe it.
