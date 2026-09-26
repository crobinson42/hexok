---
"hexok": minor
---

Add `Mapper`, which translates an entity or a schema to the shape an adapter stores, and back. Schema checks are off unless `{ validate: true }` is set on the mapper or the call. `MapperClass` is exported so an exported subclass can keep `fromSource` and `toSource` protected.
