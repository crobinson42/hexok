---
"@hexok/queue-redis": major
---

Supports the new `@hexok/queue` options. A delayed publish goes to the sorted set `<delayedPrefix><topic>`, due on the Redis clock, and every subscription moves due entries into its stream every `promoteMs`, at most 1,000 a run and never past 90% of `maxLen`. A `{ retryInMs }` result acks the entry and adds its replacement in one script. The replacement names its group, and every other group on the topic acks it without calling its handler. A subscription logs an error after promote runs have found the stream at its mark for a minute. `concurrency` runs that many handlers at once from a slot pool that the read loop and `XAUTOCLAIM` share, and a read or claim asks only for free slots. `XAUTOCLAIM` keeps its cursor between runs and claims again while a full batch comes back. The documented ACL line adds `~hexok:queue-delayed:*` and `+zadd +zrangebyscore +zrem +xlen`. Update the ACL user before you deploy.
