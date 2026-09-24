# hexok

TypeScript primitives for hexagonal software: `Schema`, `Entity`, `UseCase`, `Port`, `Adapter`, `Mapper`, `Event`, `EventCatalog`, and `Errors`. A `Mapper` subclass implements `fromSource` and `toSource`; adapters call `toModel` and `fromModel`.

Import them from `hexok`. There is no HTTP layer and no composition root in this package. Construct use cases with the ports they need.

The root [README](../../README.md) shows the shape. Tokens and schemas are arguments of each primitive, so they cannot be forgotten. `execute` and port methods are abstract, so a missing method is a compiler error on the class. `start`, `stop`, `parse`, and `set` are concrete methods you can override.
