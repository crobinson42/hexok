---
"@plinth/domain": minor
"@plinth/app": minor
"@plinth/runtime": minor
"@plinth/testing": minor
"@plinth/infra": patch
---

Entity, TrackedEntity, ApiUseCase, and EventUseCase constructors are protected. AppBuilder and TestAppBuilder constructors are private — use `App.from` / `App.test`.
