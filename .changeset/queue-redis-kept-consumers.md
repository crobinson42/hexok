---
"@hexok/queue-redis": minor
---

`stop()` and `unsubscribe()` log a `warn` for each consumer they keep, with `topic`, `group`, `consumer`, and `reason`. The reason is `inflight`, `not_ready`, `pending`, or `timeout`. `RedisQueue.keptConsumers` lists the consumers kept since the last `start()`. A consumer kept with a pending entry, and one left when `stop()` timed out, were silent before. The existing `unsubscribe()` timeout warning gains `consumer` and `reason`.
