---
"hexok": major
---

Hexok is now the primitives only: `Schema`, `Entity`, `UseCase`, `Port`, `Adapter`, `Event`, `EventCatalog`, and `Errors`, imported from `hexok`.

`Errors` is an application error catalog. `throw DomainError.UserExists({ id })` from a use case, an entity, or an adapter. A gateway imports that catalog and maps each member.

The token and any schema are arguments of the primitive (`class User extends Entity('User', userSchema)`), so a subclass does not declare `static readonly` fields and does not write `as const`. Required behavior is an abstract method. Omitting `execute`, or a port method on an adapter, is a compiler error on that class. `start`, `stop`, `parse`, and `set` can be overridden.

`hexok/core`, `hexok/domain`, `hexok/app`, `hexok/infra`, `hexok/runtime`, and `hexok/testing` are gone, along with `App.from`, HTTP, RPC, guards, interceptors, and channels. A use case takes its ports in the constructor. The application constructs it.
