---
"kerf": minor
---

Unify Kerf identities on `key` (events, entities, use cases, port tokens, catalogs, interceptors, envelopes). `Port.token<I>()(key)` infers a literal key. Event catalogs accumulate registered classes so `publish()` is typed from `static publishes`.
