# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 5.

```ts
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();
```

`XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID`. Both may delete entries that are still pending. An encode failure rejects `publish` and does not call `XADD`. A failed age trim still resolves `publish` with the stream id.

Each subscription has its own blocking connection, in-flight set, heartbeat, and `XAUTOCLAIM`. Heartbeat is `XCLAIM` with ids and then `JUSTID`. An empty snapshot does not call `XCLAIM`. `retry` removes the id so it stays idle and can be reclaimed. After `unsubscribe` or `stop()`, an in-flight handler must not `XACK`. There is no dead-letter stream. Pass a structural logger. This package does not depend on `@hexok/logger`.
