---
"hexok": minor
---

Add `UseCase.GuardParameters<typeof Factory>`, the call `{ ctx, spec, token, input }` passed to a `UseCase.context` guard and to `preExecute`. `input` is the argument passed to `execute`. Hexok does not validate it. `UseCase.context<Ctx, Spec>()` returns a factory. The optional argument is a settings object with no keys yet. `.guard(fn)` and `.hooks(def)` each return that factory. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. `UseCase.context` returns `UseCase.ContextFactory`, so an exported factory const infers its type under declaration emit.
