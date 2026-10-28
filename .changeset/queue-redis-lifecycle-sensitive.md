---
"@hexok/queue-redis": minor
---

`RedisQueue.start()` waits for the commands client to be ready, and `stop()` clears every timer and is bounded even when Redis is unreachable, so the process can exit. `publish` takes `{ sensitive }` and keeps a sensitive payload out of quarantine, logs, and the thrown error. Connection errors from every client go to the logger.
