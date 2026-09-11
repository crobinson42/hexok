# hexok

## 1.0.0

### Major Changes

- [`246ba9e`](https://github.com/crobinson42/hexok/commit/246ba9e584d6bade2a2c5f4585fe1277a9596cd2) Thanks [@crobinson42](https://github.com/crobinson42)! - Rename the library from Kerf to Hexok (Hexo Kit). Install with `npm i hexok` and import layers as `hexok/core`, `hexok/domain`, `hexok/app`, `hexok/infra`, `hexok/runtime`, and `hexok/testing`. Completeness and runtime diagnostics use the `hexok:` prefix.

### Minor Changes

- [`96f744c`](https://github.com/crobinson42/hexok/commit/96f744cf8bc4fa949adaeedffbb50e39bf95299f) Thanks [@crobinson42](https://github.com/crobinson42)! - Unify Hexok identities on `key` (events, entities, use cases, port tokens, catalogs, interceptors, envelopes). `Port.token<I>()(key)` infers a literal key. Event catalogs accumulate registered classes so `publish()` is typed from `static publishes`.

- [`ce061d1`](https://github.com/crobinson42/hexok/commit/ce061d1c4d22d816da1ec3e48f6948ead3c3f427) Thanks [@crobinson42](https://github.com/crobinson42)! - Entities throw instead of returning `Result`. `create` / `restore` / `parse` throw `CodedError` `VALIDATION`. Declared refusals use `this.error(code)` / `Incident.error(code)` (undeclared codes are a type error on the static call and a programming error at runtime). Use cases no longer unwrap entity methods.

- [`45649f2`](https://github.com/crobinson42/hexok/commit/45649f25ef52d121195c1a351e82f3cde93b18d6) Thanks [@crobinson42](https://github.com/crobinson42)! - Error maps and `CodedError` no longer carry HTTP status. Use-case `deriveContract` is transport-neutral (`key`, `input`, `output`, `errors`). Runtime HTTP maps codes to status and derives `POST /rpc/...` paths.

- [`45649f2`](https://github.com/crobinson42/hexok/commit/45649f25ef52d121195c1a351e82f3cde93b18d6) Thanks [@crobinson42](https://github.com/crobinson42)! - Entity, TrackedEntity, ApiUseCase, and EventUseCase constructors are protected. AppBuilder and TestAppBuilder constructors are private — use `App.from` / `App.test`.
