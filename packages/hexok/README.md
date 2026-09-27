# hexok

TypeScript primitives for hexagonal software: `Schema`, `Entity`, `UseCase`, `Port`, `Adapter`, `Mapper`, `Event`, `EventCatalog`, `EventHandler`, and `Errors`. A `Mapper` subclass implements `fromSource` and `toSource`; adapters call `toModel` and `fromModel`.

Import them from `hexok`. There is no HTTP layer and no composition root in this package. Construct use cases with the ports they need. `EventInstance<typeof Catalog>` is the catalog's event objects. `EventMessage<typeof Catalog>` is the `{ key, payload }` union an adapter sends. `message` and `parse` on the catalog convert between them.

`UseCase.context` is a family factory for a per-call context, an optional guard, and required statics such as an input schema. The guard receives that static contract. `UseCase(token)` still has `execute(input)`.

The root [README](../../README.md) shows the shape. Tokens and schemas are arguments of each primitive, so they cannot be forgotten. `execute`, `handle`, and port methods are abstract, so a missing method is a compiler error on the class. `start`, `stop`, `parse`, and `set` are concrete methods you can override.
