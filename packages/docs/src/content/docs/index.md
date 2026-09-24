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
| Errors | `Errors('domain', { BlankName: { message: 'Name is blank' } })` |

The string is the token. Its type is that literal. A schema is an argument of the same call, so it cannot be left out. `execute`, the methods on a port, `fromSource`, and `toSource` are abstract: the compiler reports a missing one on the class. `parse`, `set`, `start`, and `stop` are concrete methods you can override.

A use case takes its ports in the constructor. Hexok does not route HTTP or assemble the object graph.
