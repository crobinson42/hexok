---
"hexok": patch
---

`UseCase.context` factories type-check their statics without intersecting them with the spec again. A spec with a wide property type, such as a Zod schema, no longer costs thousands of type instantiations for each call.
