---
"@hexok/queue-redis": minor
---

`RedisQueue.start()` waits for the commands client to be ready, and `stop()` clears every timer so the process can exit. `publish` takes `{ sensitive }` and keeps a sensitive payload out of quarantine and logs.
