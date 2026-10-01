# hexok

## 2.1.0

### Minor Changes

- [`04a25b2`](https://github.com/crobinson42/hexok/commit/04a25b2f29fd477bdd80ea907a47ca291ad3e1e9) Thanks [@crobinson42](https://github.com/crobinson42)! - Ship an agent skill at `skills/hexok`. Install it with `npx skills add crobinson42/hexok`. `npx skills update` refreshes it from the GitHub repository. The entry skill walks a feature from the user story through entities, use cases, events, adapters, the gateway, and where handlers run, and points at a reference for each primitive.

## 2.0.0

### Major Changes

- [`ee89169`](https://github.com/crobinson42/hexok/commit/ee891693e7d571391402481871691d05cac5012a) Thanks [@crobinson42](https://github.com/crobinson42)! - `UseCase` and `Entity` no longer take an error map or expose `error()`. Application refusals are thrown from an `Errors` catalog and caught by the application. `defineErrors`, `EmptyErrors`, and `ErrorArgs` are removed. Schema checks still throw `CodedError` with code `VALIDATION`.

- [`50fd2dc`](https://github.com/crobinson42/hexok/commit/50fd2dcb3a633ad1238745271884ae07adccb557) Thanks [@crobinson42](https://github.com/crobinson42)! - Hexok is now the primitives only: `Schema`, `Entity`, `UseCase`, `Port`, `Adapter`, `Event`, `EventCatalog`, and `Errors`, imported from `hexok`.

  `Errors` is an application error catalog. `throw DomainError.UserExists({ id })` from a use case, an entity, or an adapter. A gateway imports that catalog and maps each member.

  The token and any schema are arguments of the primitive (`class User extends Entity('User', userSchema)`), so a subclass does not declare `static readonly` fields and does not write `as const`. Required behavior is an abstract method. Omitting `execute`, or a port method on an adapter, is a compiler error on that class. `start`, `stop`, `parse`, and `set` can be overridden.

  `hexok/core`, `hexok/domain`, `hexok/app`, `hexok/infra`, `hexok/runtime`, and `hexok/testing` are gone, along with `App.from`, HTTP, RPC, guards, interceptors, and channels. A use case takes its ports in the constructor. The application constructs it.

### Minor Changes

- [`50a3c2a`](https://github.com/crobinson42/hexok/commit/50a3c2ae7258c22a958432f81b4e593138eba555) Thanks [@crobinson42](https://github.com/crobinson42)! - `Errors` member factories take an optional message as the first argument. The catalog message stays the default. A member with `data` takes that payload after the message.

- [`bdeb2ee`](https://github.com/crobinson42/hexok/commit/bdeb2ee0ef8dbc16e5033eb82b3eae58e7a200b4) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `EventInstance<typeof Catalog>` for the event objects in a catalog. Each instance carries its token. `Catalog.message` and `Catalog.parse` convert between an instance and `EventMessage`. `EventHandler` binds a handler class to one event.

- [`6baf9b2`](https://github.com/crobinson42/hexok/commit/6baf9b255904aaa32b2590602578b9d371231f35) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `EventMessage<typeof Catalog>`, the `{ key, payload }` union for an event catalog. Pass a catalog key as the second type argument to keep one entry.

- [`87dd117`](https://github.com/crobinson42/hexok/commit/87dd117fc6287581417fb55840dfd60275576101) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `Mapper`, which translates an entity or a schema to the shape an adapter stores, and back. Schema checks are off unless `{ validate: true }` is set on the mapper or the call. `MapperClass` is exported so an exported subclass can keep `fromSource` and `toSource` protected.

- [`b33efaf`](https://github.com/crobinson42/hexok/commit/b33efaf7f03440cc3898f9218dd4c7f92f53ff8d) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `UseCase.context<Ctx, Spec>()`, a family factory for a per-call context, optional guards, optional hooks, and required statics. The optional argument is a settings object with no keys yet. Pass nothing. `{}` is allowed. `guard` and `hooks` are methods, not fields of that object. A missing `<Ctx>` type argument is a type error. `Spec` defaults to no required statics. `.guard(fn)` and `.hooks(def)` each return the same factory a class extends. Order does not matter. Either may be omitted. Another `.guard()` runs after guards already registered. A second `.hooks()` throws `hexok: UseCase hooks are already set` when the factory is created, if the first registration had at least one callback. An empty `.hooks({})` does not register hooks and does not wrap `execute`. The call is `{ ctx, spec, token, input }`. `input` is the argument passed to `execute`. The method receives that same value. Hexok does not validate it. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. The pipeline is guard (outside try), `preExecute`, the method, `postExecute`, `onCatch` then rethrow, `onFinally`. A guard throw does not enter the hooks. A throw inside `onCatch` replaces the error after `onFinally` sees the original one. Statics are copied onto the class. `SchemaSource` is exported.

- [`be9456d`](https://github.com/crobinson42/hexok/commit/be9456db31b3396f38e455bd816299dc77ab02af) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `UseCase.Ctx<typeof Factory>`, the context type of a `UseCase.context` factory. It is `ctx` on `UseCase.GuardParameters<typeof Factory>`. Pass the factory. A subclass, and a plain `UseCase(token)` class, are `never`.

- [`78cb3f7`](https://github.com/crobinson42/hexok/commit/78cb3f72abfa0967369c043245e76224cf105b21) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `UseCase.GuardParameters<typeof Factory>`, the call `{ ctx, spec, token, input }` passed to a `UseCase.context` guard and to `preExecute`. `input` is the argument passed to `execute`. Hexok does not validate it. `UseCase.context<Ctx, Spec>()` returns a factory. The optional argument is a settings object with no keys yet. `.guard(fn)` and `.hooks(def)` each return that factory. `.hooks` infers the value returned from `preExecute` as the `state` argument of `postExecute`, `onCatch`, and `onFinally`. If `preExecute` is omitted, that state is `void`. `postExecute` also receives `result`. `onFinally` receives `status: 'success'` with `result`, or `status: 'failure'` with `error`. `UseCase.context` returns `UseCase.ContextFactory`, so an exported factory const infers its type under declaration emit.

### Patch Changes

- [`2e15b21`](https://github.com/crobinson42/hexok/commit/2e15b21fa7314ee9f496c80ac8e99794003cdfc7) Thanks [@crobinson42](https://github.com/crobinson42)! - Add a package README, homepage, and npm keywords pointing at the docs site (https://crobinson42.github.io/hexok/).

- [`e9fafc5`](https://github.com/crobinson42/hexok/commit/e9fafc5e361642e87d1037807553438f5a482f04) Thanks [@crobinson42](https://github.com/crobinson42)! - Document `@hexok/typebox` for `typebox` 1 schematics. `typebox(schema)` infers `Static`. `typeboxDecode(schema)` infers `StaticDecode` and decodes.

## 1.0.0

### Major Changes

- [`246ba9e`](https://github.com/crobinson42/hexok/commit/246ba9e584d6bade2a2c5f4585fe1277a9596cd2) Thanks [@crobinson42](https://github.com/crobinson42)! - Rename the library from Kerf to Hexok (Hexo Kit). Install with `npm i hexok` and import layers as `hexok/core`, `hexok/domain`, `hexok/app`, `hexok/infra`, `hexok/runtime`, and `hexok/testing`. Completeness and runtime diagnostics use the `hexok:` prefix.

### Minor Changes

- [`96f744c`](https://github.com/crobinson42/hexok/commit/96f744cf8bc4fa949adaeedffbb50e39bf95299f) Thanks [@crobinson42](https://github.com/crobinson42)! - Unify Hexok identities on `key` (events, entities, use cases, port tokens, catalogs, interceptors, envelopes). `Port.token<I>()(key)` infers a literal key. Event catalogs accumulate registered classes so `publish()` is typed from `static publishes`.

- [`ce061d1`](https://github.com/crobinson42/hexok/commit/ce061d1c4d22d816da1ec3e48f6948ead3c3f427) Thanks [@crobinson42](https://github.com/crobinson42)! - Entities throw instead of returning `Result`. `create` / `restore` / `parse` throw `CodedError` `VALIDATION`. Declared refusals use `this.error(code)` / `Incident.error(code)` (undeclared codes are a type error on the static call and a programming error at runtime). Use cases no longer unwrap entity methods.

- [`dfc6ffb`](https://github.com/crobinson42/hexok/commit/dfc6ffbebfceea9b744c08088ec66312f1d464f1) Thanks [@crobinson42](https://github.com/crobinson42)! - Catalog kind `broker` is now `queue` (`QueueAdapter`, `InMemoryQueue`). `EventChannel` + `.route(channel, adapter)` owns join, claim refresh, and fan-out to live sessions on a bus catalog. Presence is a `ChannelAdapter`; distribution stays `.bind(catalog, bus)`.

- [`795080a`](https://github.com/crobinson42/hexok/commit/795080a504565970ddced5e173300f4e38ec7828) Thanks [@crobinson42](https://github.com/crobinson42)! - Replace `ApiUseCase` with sibling `ExternalUseCase` (`trigger: 'external'`) and `InternalUseCase` (`trigger: 'internal'`). Delete `static internal` and per-use-case `static middleware`. `deriveContract` returns `{ entries }` instead of `{ routes }`. HTTP RPC stays in `hexok/runtime`.

- [`45649f2`](https://github.com/crobinson42/hexok/commit/45649f25ef52d121195c1a351e82f3cde93b18d6) Thanks [@crobinson42](https://github.com/crobinson42)! - Error maps and `CodedError` no longer carry HTTP status. Use-case `deriveContract` is transport-neutral (`key`, `input`, `output`, `errors`). Runtime HTTP maps codes to status and derives `POST /rpc/...` paths.

- [`45649f2`](https://github.com/crobinson42/hexok/commit/45649f25ef52d121195c1a351e82f3cde93b18d6) Thanks [@crobinson42](https://github.com/crobinson42)! - Entity, TrackedEntity, ApiUseCase, and EventUseCase constructors are protected. AppBuilder and TestAppBuilder constructors are private — use `App.from` / `App.test`.
