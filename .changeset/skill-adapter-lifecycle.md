---
"hexok": patch
---

The skill's adapter reference covers the Redis adapters' shared lifecycle: await `start()` and `subscribe()`, stop in reverse order, and match on the lifecycle error `code`. It explains `state`, each error code and when to retry, `startTimeoutMs`, and how every adapter's `stopTimeoutMs` must fit in the Kubernetes grace period.
