---
"@hexok/ioredis-lifecycle": major
"@hexok/queue-redis": major
"@hexok/broadcast-redis": major
"@hexok/schedule-coordinator-redis": major
---

Require `ioredis` 6. Connections negotiate RESP3 and keep v5 reply shapes. `@hexok/ioredis-lifecycle` no longer accepts `ioredis` 5.
