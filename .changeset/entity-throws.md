---
"kerf": minor
---

Entities throw instead of returning `Result`. `create` / `restore` / `parse` throw `CodedError` `VALIDATION`. Declared refusals use `this.error(code)` / `Incident.error(code)` (undeclared codes are a type error on the static call and a programming error at runtime). Use cases no longer unwrap entity methods.
