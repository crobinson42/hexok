# App template

A small backend that uses hexok primitives and wires them by hand.

`inMemoryEvents()` builds an `InMemoryEventPublisher` and an `InMemoryEventSubscriptions` over one in-memory log. Those adapters implement `DomainEventPublisher` and `DomainEventSubscriptions`. `createWebApp()` gives the publisher to `CreateUser` and subscribes `SendWelcomeEmailHandler` and `IndexUserHandler`. `createHeavyWorker()` subscribes `HeavyComputationTaskHandler` on a `DomainEventSubscriptions`. Each handler names its event and a `groupId`. Call `subscriptions.start()` before publishing. The publisher delivers to handlers registered on that same log. A broker implements the same two ports, and `groupId` is the competing-consumer name. Replace an adapter, or pass a different `UserRepository`, at the edge of the process. Hexok does not register, route, or start that graph.

`DomainError` is the application's error catalog. `UserEntity.rename` and `CreateUser` throw its members. `mapError` turns a member into a status code. Hexok does not do that mapping.
