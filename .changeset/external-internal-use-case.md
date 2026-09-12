---
"hexok": minor
---

Replace `ApiUseCase` with sibling `ExternalUseCase` (`trigger: 'external'`) and `InternalUseCase` (`trigger: 'internal'`). Delete `static internal` and per-use-case `static middleware`. `deriveContract` returns `{ entries }` instead of `{ routes }`. HTTP RPC stays in `hexok/runtime`.
