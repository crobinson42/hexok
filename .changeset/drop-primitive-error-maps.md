---
"hexok": major
---

`UseCase` and `Entity` no longer take an error map or expose `error()`. Application refusals are thrown from an `Errors` catalog and caught by the application. `defineErrors`, `EmptyErrors`, and `ErrorArgs` are removed. Schema checks still throw `CodedError` with code `VALIDATION`.
