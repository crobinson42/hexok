---
"@hexok/queue-redis": minor
---

Consumers no longer trim. A queue that only subscribes to a topic never trims that stream, so a consumer no longer deletes entries, read or not, under its own `retentionMs`. A publisher still trims the topics it published to, after each publish and every minute. A stream with no running publisher is not age-trimmed. `RedisQueueConfig` takes `trim`, either `'published'`, the default, or `false`, which never age-trims. `MAXLEN ~` on `XADD` applies either way.
