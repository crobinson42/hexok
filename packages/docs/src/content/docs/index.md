---
title: Hexok
description: Primitives for hexagonal TypeScript.
---

Hexok is a small set of classes. Import them from `hexok`. The [Concepts](/hexok/concepts/) pages say what each one is for.

## Installing

```bash
npm i hexok
```

The package is [hexok](https://www.npmjs.com/package/hexok) on npm. The repository is [crobinson42/hexok](https://github.com/crobinson42/hexok) on GitHub. TypeBox 1 schematics install as [@hexok/typebox](https://www.npmjs.com/package/@hexok/typebox).

## Layers

<figure class="hexok-layers">
<svg class="rings" viewBox="0 0 900 900" role="group" aria-labelledby="hexok-layers-title" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
<title id="hexok-layers-title">Hexok primitives in the clean architecture layers</title>
<circle cx="450" cy="450" r="432" fill="#F6E29A" stroke="#D4C06A" stroke-width="2"/>
<circle cx="450" cy="450" r="352" fill="#C9DDAF" stroke="#A8C48C" stroke-width="2"/>
<circle cx="450" cy="450" r="262" fill="#F0B5A4" stroke="#E09A86" stroke-width="2"/>
<circle cx="450" cy="450" r="158" fill="#2F4E7A" stroke="#284266" stroke-width="2"/>
<g fill="#4A3D18" font-size="18" font-weight="600" text-anchor="middle" dominant-baseline="middle">
<text x="450" y="58">Frameworks &amp; Drivers</text>
<text x="782" y="242">HTTP</text>
<text x="842" y="450">Email</text>
<text x="450" y="842">Database</text>
<text x="58" y="450">Queue</text>
</g>
<g fill="#24381C" font-size="18" font-weight="600" text-anchor="middle" dominant-baseline="middle">
<text x="450" y="143">Interface Adapters</text>
</g>
<a href="/hexok/concepts/adapter/">
<text x="450" y="757" fill="#1C3218" font-size="22" font-weight="650" text-anchor="middle" dominant-baseline="middle">Adapter</text>
</a>
<g fill="#5C3228" font-size="18" font-weight="600" text-anchor="middle" dominant-baseline="middle">
<text x="450" y="240">Application</text>
</g>
<g fill="#4A221C" font-size="20" font-weight="650" text-anchor="middle" dominant-baseline="middle">
<a href="/hexok/concepts/use-case/"><text x="289" y="585">UseCase</text></a>
<a href="/hexok/concepts/port/"><text x="611" y="585">Port</text></a>
<a href="/hexok/concepts/event-handler/"><text x="450" y="668">EventHandler</text></a>
</g>
<g fill="#D5DEEA" font-size="16" font-weight="600" text-anchor="middle" dominant-baseline="middle">
<text x="450" y="392">Domain</text>
</g>
<g fill="#FFFFFF" font-size="22" font-weight="650" text-anchor="middle" dominant-baseline="middle">
<a href="/hexok/concepts/entity/"><text x="378" y="436">Entity</text></a>
<a href="/hexok/concepts/schema/"><text x="522" y="436">Schema</text></a>
<a href="/hexok/concepts/error/"><text x="378" y="474">Error</text></a>
<a href="/hexok/concepts/event/"><text x="522" y="474">Event</text></a>
<a href="/hexok/concepts/event-catalog/"><text x="450" y="520">EventCatalog</text></a>
</g>
</svg>
<div class="stack">
<div class="band frameworks">
<p class="band-name">Frameworks &amp; Drivers</p>
<p class="band-items">HTTP · Database · Queue · Email</p>
<div class="band adapters">
<p class="band-name">Interface Adapters</p>
<p class="band-items"><a href="/hexok/concepts/adapter/">Adapter</a></p>
<div class="band application">
<p class="band-name">Application</p>
<p class="band-items"><a href="/hexok/concepts/use-case/">UseCase</a> <a href="/hexok/concepts/port/">Port</a> <a href="/hexok/concepts/event-handler/">EventHandler</a></p>
<div class="band domain">
<p class="band-name">Domain</p>
<p class="band-items"><a href="/hexok/concepts/entity/">Entity</a> <a href="/hexok/concepts/schema/">Schema</a> <a href="/hexok/concepts/error/">Error</a> <a href="/hexok/concepts/event/">Event</a> <a href="/hexok/concepts/event-catalog/">EventCatalog</a></p>
</div>
</div>
</div>
</div>
</div>
<figcaption>The domain is the center. Dependencies point inward. The outer layer is the HTTP gateway, database, queue, and email client you choose.</figcaption>
</figure>

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

`.guard(fn)` and `.hooks(def)` each return the same factory a class extends. Order does not matter. Either may be omitted. Another `.guard()` runs after guards already registered. A second `.hooks()` throws `hexok: UseCase hooks are already set` when the factory is created, if the first registration had at least one callback. An empty `.hooks({})` does not register hooks and does not wrap `execute`. The call is `{ ctx, spec, token, input }`. `input` is the argument passed to `execute`. The method receives that same value. Hexok does not validate it. `call.spec` is the static bag, typed as that contract. `UseCase.GuardParameters<typeof ApiUseCase>` is that call. `UseCase.Ctx<typeof ApiUseCase>` is that `ctx`. Pass the factory. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. The pipeline is guard (outside try), `preExecute`, the method, `postExecute`, `onCatch` then rethrow, `onFinally`. A guard throw does not enter the hooks. A throw inside `onCatch` replaces the error after `onFinally` sees the original one. The application validates `input`. A schema on the static bag is application data. `SchemaSource` is exported for a Standard Schema or a `Schema` class, the same values `Entity` and `Event` accept. `@hexok/typebox` adapts a `typebox` 1 schematic to a Standard Schema. `typebox(schema)` infers `Static`. `typeboxDecode(schema)` infers `StaticDecode` and decodes. Zod and other Standard Schema libraries are passed to the primitives directly.

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
