---
"@hexok/queue-redis": major
---

Supports the new `@hexok/queue` options. A delayed publish goes to the sorted set `<delayedPrefix><topic>`, and every subscription moves due entries into its stream every `promoteMs`, at most 1,000 a run and never past 90% of `maxLen`. A `{ retryInMs }` result acks the entry and adds its replacement in one script. `concurrency` runs that many handlers at once from a slot pool that the read loop and `XAUTOCLAIM` share, and a read or claim asks only for free slots. `XAUTOCLAIM` keeps its cursor between runs and claims again while a full batch comes back. The documented ACL line adds `~hexok:queue-delayed:*` and `+zadd +zrangebyscore +zrem +xlen`. Update the ACL user before you deploy.
