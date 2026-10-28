# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 5.

```ts
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();
```

`start()` resolves when the commands client is ready. It connects a client made with `lazyConnect`. Connection errors go to the logger and do not reject, so an app that boots before Redis waits for it. Each error has a `connection` field, `commands` or `blocking`. A blocking connection's error also has its `topic`. `start()` rejects when the client ends. A later `start()` opens a new client. `stop()` rejects a pending `start()` and clears every timer this package sets, so the process can exit. When Redis is unreachable, the process can stay alive for the ioredis `disconnectTimeout` after `stop()` resolves. That is 2 seconds by default. Set `disconnectTimeout` in the `redis` options to shorten it.

`XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID`. Both may delete entries that are still pending. An encode failure rejects `publish` and does not call `XADD`. A failed age trim still resolves `publish` with the stream id.

Each subscription has its own blocking connection, in-flight set, heartbeat, and `XAUTOCLAIM`. Heartbeat is `XCLAIM` with ids and then `JUSTID`. An empty snapshot does not call `XCLAIM`. `retry` removes the id so it stays idle and can be reclaimed. After `unsubscribe` or `stop()`, an in-flight handler must not `XACK`. There is no dead-letter stream. An optional `quarantine` sink parks a failed encode or `XADD`, a missing payload, and a decode failure. A handler `'drop'` is not parked. Pass a structural logger and quarantine sink. This package does not depend on `@hexok/logger` or `@hexok/quarantine`.

`publish(topic, payload, { sensitive: true })` adds a `sensitive` field to the entry. Other entries are unchanged. A failed encode or `XADD` parks `{ sensitive: true }` in place of the payload. Its parked error is `queue: encode failed` or `queue: XADD failed` with the original `name` and `code`. A failed `XADD` rejects with a copy of the Redis error that keeps `name`, `message`, and `code`. It drops `command`, which holds the payload. A sensitive entry that fails to decode parks no `raw`, and its log and parked error say only `queue: decode failed`. The handler still gets the payload. An error the handler throws is logged as thrown.

`maintain()` scans the key prefix. `dryRun` defaults to true and does not write. Pass `idleConsumerMs` to remove idle `hexok:` consumers that own no pending entries. `dropIdleGroups` destroys a group only when it has no consumers, no pending entries, and a last-delivered id older than `idleMs`. That drops the cursor. `dropIdleStreams` deletes a key only when it has no groups and its last id is older than `idleMs`. `0-0` is never treated as old. Run it from one cron. `unsubscribe` and `stop()` remove this process's consumer when nothing is in flight. An in-flight handler still does not `XACK`, and that consumer is left so its pending entries stay.
