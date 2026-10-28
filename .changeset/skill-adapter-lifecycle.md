---
"hexok": patch
---

The skill's adapter reference covers adapters that own a connection: await `start()` and `subscribe()`, stop in reverse order, and branch on the lifecycle error `code`. It explains `StoppedBeforeReply`, `startTimeoutMs`, and `stopTimeoutMs`.
