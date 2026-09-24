# App template

A small backend that uses hexok primitives and wires them by hand.

`createApp()` constructs `CreateUser` with an `InMemoryUsers` adapter. Replace the adapter, or pass a different `UserRepository`, at the edge of the process. Hexok does not register, route, or start that graph.

`DomainError` is the application's error catalog. `UserEntity.rename` and `CreateUser` throw its members. `mapError` turns a member into a status code. Hexok does not do that mapping.
