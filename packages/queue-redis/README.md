# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 5.

```ts
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();
```

`XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID`. Both may delete entries that are still pending. An encode failure rejects `publish` and does not call `XADD`. A failed age trim still resolves `publish` with the stream id.

Each subscription has its own blocking connection, in-flight set, heartbeat, and `XAUTOCLAIM`. Heartbeat is `XCLAIM` with ids and then `JUSTID`. An empty snapshot does not call `XCLAIM`. `retry` removes the id so it stays idle and can be reclaimed. After `unsubscribe` or `stop()`, an in-flight handler must not `XACK`. There is no dead-letter stream. An optional `quarantine` sink parks a failed encode or `XADD`, a missing payload, and a decode failure. A handler `'drop'` is not parked. Pass a structural logger and quarantine sink. This package does not depend on `@hexok/logger` or `@hexok/quarantine`.

`maintain()` scans the key prefix. `dryRun` defaults to true and does not write. Pass `idleConsumerMs` to remove idle `hexok:` consumers that own no pending entries. `dropIdleGroups` destroys a group only when it has no consumers, no pending entries, and a last-delivered id older than `idleMs`. That drops the cursor. `dropIdleStreams` deletes a key only when it has no groups and its last id is older than `idleMs`. `0-0` is never treated as old. Run it from one cron. `unsubscribe` and `stop()` remove this process's consumer when nothing is in flight. An in-flight handler still does not `XACK`, and that consumer is left so its pending entries stay.
