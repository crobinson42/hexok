# Hexok

Hexok is a small TypeScript kit for hexagonal software. You extend a primitive, and the compiler tells you what that primitive still requires. You wire objects together yourself.

Documentation: [crobinson42.github.io/hexok](https://crobinson42.github.io/hexok/).

```bash
npm i hexok
```

## Agent skill

This repository includes an agent skill named `hexok`. It walks a feature from the user story through entities, use cases, events, adapters, the gateway, and where handlers run. Install it from GitHub. `npx skills update` refreshes that install from GitHub.

```bash
npx skills add crobinson42/hexok
npx skills update
```

```ts
import { Adapter, Entity, Errors, Event, EventCatalog, EventHandler, Mapper, Port, Schema, UseCase } from 'hexok'
```

| Primitive | What you extend | What the compiler requires |
| --- | --- | --- |
| `Schema` | `Schema('User', zodSchema)` | the token and the schema are arguments |
| `Entity` | `Entity('User', UserSchema)` | `create` and `set` are already implemented; add rules as methods |
| `Port` | `Port('UserRepository')` | the abstract methods you declare on the port |
| `Adapter` | `Adapter(UserRepository)` | every abstract port method; override `start` / `stop` when you need them |
| `Mapper` | `Mapper('mongo.User', User, mongoUserSchema)` | `fromSource` and `toSource`; adapters call `toModel` and `fromModel` |
| `UseCase` | `UseCase('user.create')` | `execute`. Pass ports through the constructor. `UseCase.context` is the family factory |
| `Event` | `Event('user.created', UserSchema)` | the token and the payload schema are arguments |
| `EventCatalog` | `EventCatalog('domain', { userCreated })` | the token and the event map are arguments |
| `EventHandler` | `EventHandler('on.user.created', UserCreated)` | `handle` |
| `Errors` | `Errors('domain', { BlankName: { message } })` | each key is a factory; throw the error it returns |

`Result`, `CodedError`, and Standard Schema helpers ship next to the primitives. `EventInstance<typeof DomainEvents>` is the catalog's event objects. A use case publishes `new UserCreated(...)`. `EventMessage<typeof DomainEvents>` is `{ key, payload }` for an adapter. `DomainEvents.message` and `DomainEvents.parse` convert between them. Pass a catalog key as the second type argument to keep one entry. HTTP, gateways, and composition do not. A use case receives its ports in the constructor, and the application constructs that use case.

```ts
class DomainError extends Errors('domain', {
  BlankName: { message: 'Name is blank' },
  UserExists: { message: 'User already exists', data: z.object({ id: z.string() }) },
  Unauthorized: { message: 'Unauthorized' },
}) {}

class User extends Entity('User', userSchema) {
  rename(name: string): this {
    if (name.trim() === '') throw DomainError.BlankName()
    return this.set((draft) => {
      draft.name = name
    })
  }
}

abstract class UserRepository extends Port('UserRepository') {
  abstract get(id: string): Promise<User | null>
  abstract save(user: User): Promise<void>
}

class InMemoryUsers extends Adapter(UserRepository) {
  override async get(id: string): Promise<User | null> { /* ... */ }
  override async save(user: User): Promise<void> { /* ... */ }
}

class CreateUser extends UseCase('user.create') {
  constructor(private readonly users: UserRepository) { super() }
  async execute(input: { id: string; name: string; email: string }): Promise<User> {
    const existing = await this.users.get(input.id)
    if (existing) throw DomainError.UserExists({ id: input.id })
    const user = User.create(input)
    await this.users.save(user)
    return user
  }
}

const createUser = new CreateUser(new InMemoryUsers())
await createUser.execute({ id: '1', name: 'Ada', email: 'ada@ex.com' })
```

The string you pass is the token. Its type is that string literal. A subclass does not redeclare it, and a different literal is not assignable over the top of it.

`static abstract` is not part of TypeScript, so a base class cannot force a subclass to fill in a static field. Hexok therefore takes the token and the schema as arguments of the primitive. Required behavior is an abstract instance method: omit `execute`, omit a port method on an adapter, or omit `fromSource` or `toSource` on a mapper, and the error is on that class.

`UseCase.context` returns a factory for one family. `UseCase('user.create')` is unchanged: `execute(input)`, ports in the constructor. `StandardSchemaV1` and `InferSchema` are exported from `hexok`. Zod and the other Standard Schema libraries satisfy `StandardSchemaV1`.

`@hexok/typebox` adapts a `typebox` 1 schematic to that same interface. `typebox(schema)` infers `Static`. `typeboxDecode(schema)` infers `StaticDecode` and decodes.

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
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: { query: string },
  ): Promise<User[]> {
    return this.users.search(input.query)
  }
}

await new FindUsers(users).execute({ sessionId: 's' }, { query: 'ada' })
```

The first type argument is the per-call context. A missing `<Ctx>` type argument is a type error. The second is the required static contract. It defaults to no required statics, and then the factory takes only the token. Each use case passes the token and the static values. They are inherited statics: `FindUsers.token`, `FindUsers.input`, `FindUsers.permission`. The permission literal stays narrow. Extra keys are kept. `token`, `prototype`, `name`, and `length` cannot be static names.

Ports stay constructor arguments. Context is an `execute` argument because a use case instance is long-lived. Annotate `execute` on the subclass. Callers see that annotation. Hexok passes that argument through to the method. Statics, including a schema stored under the key `input`, are application data copied onto the class (`call.spec.input`). The execute argument is `call.input`. Hexok does not validate it. `SchemaSource` is exported for a Standard Schema or a `Schema` class, the same values as `Entity` and `Event`.

`UseCase.context<Ctx, Spec>()` returns that factory. The optional argument is a settings object with no keys yet. Pass nothing. `{}` is allowed. `guard` and `hooks` are methods, not fields of that object. `.guard(fn)` and `.hooks(def)` each return the same factory a class extends. Order does not matter. Either may be omitted. Another `.guard()` runs after guards already registered. A second `.hooks()` throws `hexok: UseCase hooks are already set` when the factory is created, if the first registration had at least one callback. An empty `.hooks({})` does not register hooks and does not wrap `execute`.

The call is `{ ctx, spec, token, input }`. `input` is the argument passed to `execute`. The method receives that same value. `spec` is the static bag, typed as the family contract, so `permission` is `string`. `UseCase.GuardParameters<typeof ApiUseCase>` is that call. `UseCase.Ctx<typeof ApiUseCase>` is that `ctx`. Pass the factory. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. The pipeline is guard (outside try), `preExecute`, the method, `postExecute`, `onCatch` then rethrow, `onFinally`. A guard throw does not enter the hooks. A throw inside `onCatch` replaces the error after `onFinally` sees the original one. The application reads statics (`FindUsers.permission`) and validates `input` when it needs to. `execute` is a method. Hexok does not know HTTP, sessions, or callers. The application builds the context and writes the guard.

An adapter owns a mapper when the shape it stores is not the shape the port speaks.

```ts
class MongoUser extends Mapper('mongo.User', User, mongoUserSchema) {
  protected fromSource(user: User) {
    const [lat, lng] = user.toProps().location
    return {
      _id: user.props.id,
      name: user.props.name,
      location: { type: 'Point' as const, coordinates: [lng, lat] },
    }
  }

  protected toSource(doc: MongoUserDoc) {
    const [lng, lat] = doc.location.coordinates
    return { id: doc._id, name: doc.name, location: [lat, lng] }
  }
}

const model = new MongoUser()
const doc = model.toModel(user)
const loaded = model.fromModel(raw)
```

Checks are off unless the mapper or the call passes `{ validate: true }`. For an entity source, `fromModel` returns the entity: `parse` when checks are on, `restore` when they are off. The source may be a Schema instead of an Entity, so a log record that is not an entity uses the same primitive. Another mapper can store the same entity as a Postgres point. The mapper does not commit the entity, and it is not a query builder.

See `examples/app-template` for a wired slice and `examples/extend` for overriding `parse` and `start`.
