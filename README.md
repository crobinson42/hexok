# Hexok

Hexok is a small TypeScript kit for hexagonal software. You extend a primitive, and the compiler tells you what that primitive still requires. You wire objects together yourself.

```bash
npm i hexok
```

```ts
import { Adapter, Entity, Errors, Event, EventCatalog, Port, Schema, UseCase } from 'hexok'
```

| Primitive | What you extend | What the compiler requires |
| --- | --- | --- |
| `Schema` | `Schema('User', zodSchema)` | the token and the schema are arguments |
| `Entity` | `Entity('User', UserSchema)` | `create` and `set` are already implemented; add rules as methods |
| `Port` | `Port('UserRepository')` | the abstract methods you declare on the port |
| `Adapter` | `Adapter(UserRepository)` | every abstract port method; override `start` / `stop` when you need them |
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

`static abstract` is not part of TypeScript, so a base class cannot force a subclass to fill in a static field. Hexok therefore takes the token and the schema as arguments of the primitive. Required behavior is an abstract instance method: omit `execute`, or omit a port method on an adapter, and the error is on that class.

See `examples/app-template` for a wired slice and `examples/extend` for overriding `parse` and `start`.
