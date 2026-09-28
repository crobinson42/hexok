---
title: Hexok
description: Primitives for hexagonal TypeScript.
---

Hexok is a small set of classes. Import them from `hexok`.

| Primitive | Extend |
| --- | --- |
| Schema | `Schema('User', zodSchema)` |
| Entity | `Entity('User', userSchema)` |
| Port | `Port('UserRepository')` |
| Adapter | `Adapter(UserRepository)` |
| Mapper | `Mapper('mongo.User', User, mongoUserSchema)` |
| UseCase | `UseCase('user.create')` |
| Event | `Event('user.created', userSchema)` |
| EventCatalog | `EventCatalog('domain', { userCreated })` |
| EventHandler | `EventHandler('on.user.created', UserCreated)` |
| Errors | `Errors('domain', { BlankName: { message: 'Name is blank' } })` |

`EventInstance<typeof DomainEvents>` is the catalog's event objects. A use case publishes `new UserCreated(...)`. `EventMessage<typeof DomainEvents>` is `{ key, payload }` for an adapter. `DomainEvents.message` and `DomainEvents.parse` convert between them. Pass a catalog key as the second type argument to keep one entry.

The string is the token. Its type is that literal. A schema is an argument of the same call, so it cannot be left out. `execute`, `handle`, the methods on a port, `fromSource`, and `toSource` are abstract: the compiler reports a missing one on the class. `parse`, `set`, `start`, and `stop` are concrete methods you can override.

A use case takes its ports in the constructor. Hexok does not route HTTP or assemble the object graph.

`UseCase.context<Ctx, Spec>()` is a family factory in addition to `UseCase('user.create')`. It returns a factory. The optional argument is a settings object with no keys yet. Pass nothing. `{}` is allowed. `guard` and `hooks` are methods, not fields of that object. A missing `<Ctx>` type argument is a type error. `Spec` defaults to no required statics. `execute` takes a per-call context and the input. Ports stay in the constructor. Annotate `input` on the subclass.

`.guard(fn)` and `.hooks(def)` each return the same factory a class extends. Order does not matter. Either may be omitted. Another `.guard()` runs after guards already registered. A second `.hooks()` throws `hexok: UseCase hooks are already set` when the factory is created, if the first registration had at least one callback. An empty `.hooks({})` does not register hooks and does not wrap `execute`. The call is `{ ctx, spec, token, input }`. `input` is the argument passed to `execute`. The method receives that same value. Hexok does not validate it. `call.spec` is the static bag, typed as that contract. `UseCase.GuardParameters<typeof ApiUseCase>` is that call. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. The pipeline is guard (outside try), `preExecute`, the method, `postExecute`, `onCatch` then rethrow, `onFinally`. A guard throw does not enter the hooks. A throw inside `onCatch` replaces the error after `onFinally` sees the original one. The application validates `input`. A schema on the static bag is application data. `SchemaSource` is exported for a Standard Schema or a `Schema` class, the same values `Entity` and `Event` accept.

```ts
type ApiContext = { sessionId: string }

const ApiUseCase = UseCase.context<
  ApiContext,
  { input: StandardSchemaV1; permission: string }
>()
  .guard((call) => {
    if (call.ctx.sessionId.length < 1 || call.spec.permission.length < 1) {
      throw DomainError.Unauthorized()
    }
  })
  .hooks({
    preExecute: () => ({ started: Date.now() }),
    postExecute(_call, state) {
      void state.started
    },
  })

class FindUsers extends ApiUseCase('user.find', {
  input: z.object({ query: z.string() }),
  permission: 'users.read',
}) {
  constructor(private readonly users: UserRepository) { super() }
  async execute(
    ctx: ApiContext,
    input: { query: string },
  ): Promise<User[]> {
    return this.users.search(input.query)
  }
}

await new FindUsers(users).execute({ sessionId: 's' }, { query: 'ada' })
```
