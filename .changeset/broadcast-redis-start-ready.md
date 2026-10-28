---
"@hexok/broadcast-redis": patch
---

`RedisBroadcast.start()` resolves once the publisher and the subscriber are ready. Connection errors go to the `LogSink`. `start()` rejects when a connection ends, and a later `start()` can retry.
