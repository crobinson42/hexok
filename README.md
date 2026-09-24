# Hexok

Hexok is a small TypeScript kit for hexagonal software. You extend a primitive, and the compiler tells you what that primitive still requires. You wire objects together yourself.

```bash
npm i hexok
```

```ts
import { Adapter, Entity, Errors, Event, EventCatalog, Mapper, Port, Schema, UseCase } from 'hexok'
```

| Primitive | What you extend | What the compiler requires |
| --- | --- | --- |
| `Schema` | `Schema('User', zodSchema)` | the token and the schema are arguments |
| `Entity` | `Entity('User', UserSchema)` | `create` and `set` are already implemented; add rules as methods |
| `Port` | `Port('UserRepository')` | the abstract methods you declare on the port |
| `Adapter` | `Adapter(UserRepository)` | every abstract port method; override `start` / `stop` when you need them |
| `Mapper` | `Mapper('mongo.User', User, mongoUserSchema)` | `fromSource` and `toSource`; adapters call `toModel` and `fromModel` |
| `UseCase` | `UseCase('user.create')` | `execute`. Pass ports through the constructor |
| `Event` | `Event('user.created', UserSchema)` | the token and the payload schema are arguments |
| `EventCatalog` | `EventCatalog('domain', { userCreated })` | the token and the event map are arguments |
| `Errors` | `Errors('domain', { BlankName: { message } })` | each key is a factory; throw the error it returns |

`Result`, `CodedError`, and Standard Schema helpers ship next to the primitives. HTTP, gateways, and composition do not. A use case receives its ports in the constructor, and the application constructs that use case.

```ts
class DomainError extends Errors('domain', {
  BlankName: { message: 'Name is blank' },
  UserExists: { message: 'User already exists', data: z.object({ id: z.string() }) },
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
