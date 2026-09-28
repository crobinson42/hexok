---
"hexok": minor
---

Add `UseCase.Ctx<typeof Factory>`, the context type of a `UseCase.context` factory. It is `ctx` on `UseCase.GuardParameters<typeof Factory>`. Pass the factory. A subclass, and a plain `UseCase(token)` class, are `never`.
