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

`UseCase.context` is a family factory in addition to `UseCase('user.create')`. `execute` takes a per-call context and the command. Ports stay in the constructor. The second type argument is the required static contract, such as an input schema. Annotate the command with `InferSchema` of that static `input`. An optional `guard` runs first and may throw. When `input` is a schema, hexok validates with `validate` and throws `CodedError` code `VALIDATION`, message `hexok: ${token} validation failed`. `SchemaSource` is exported for a Standard Schema or a `Schema` class, the same values `Entity` and `Event` accept.

```ts
type ApiContext = { sessionId: string }

const ApiUseCase = UseCase.context<
  ApiContext,
  { input: StandardSchemaV1; permission: string }
>({
  guard(ctx) {
    if (ctx.sessionId.length < 1) throw DomainError.Unauthorized()
  },
})

class FindUsers extends ApiUseCase('user.find', {
  input: z.object({ query: z.string() }),
  permission: 'users.read',
}) {
  constructor(private readonly users: UserRepository) { super() }
  async execute(
    ctx: ApiContext,
    input: InferSchema<(typeof FindUsers)['input']>,
  ): Promise<User[]> {
    return this.users.search(input.query)
  }
}

await new FindUsers(users).execute({ sessionId: 's' }, { query: 'ada' })
```
