---
"@plinth/domain": minor
"@plinth/app": minor
"@plinth/runtime": minor
"@plinth/testing": minor
"@plinth/infra": patch
---

Unify Plinth identities on `key` (events, entities, use cases, port tokens, catalogs, interceptors, envelopes). `Port.token<I>()(key)` infers a literal key. Event catalogs accumulate registered classes so `publish()` is typed from `static publishes`.
