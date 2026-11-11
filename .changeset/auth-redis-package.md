---
"@hexok/auth-redis": minor
---

New package. `RedisSessionStore` keeps `@hexok/auth` sessions in Redis on `@hexok/ioredis-lifecycle`. Each session is one hash under a SHA-256 of its id, typed and checked by a Standard Schema of the identity. `resolve` enforces the absolute end and slides the idle TTL in one script. `sessionKey` gives a session's key for debugging.
