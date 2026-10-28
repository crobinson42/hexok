---
"@hexok/broadcast-redis": patch
---

`RedisBroadcast.start()` resolves once the publisher and the subscriber are ready. Connection errors go to the `LogSink`. `start()` rejects when a connection ends or `stop()` is called first, and a later `start()` can retry. `subscribe` resolves only after Redis confirms `SUBSCRIBE`, even when another `subscribe` to the channel is pending. A failed `SUBSCRIBE` removes the channel's handlers. `stop()` does not wait on an unreachable Redis.
