# @hexok/schedule-coordinator-redis

Per-job Redis lock for `@hexok/schedule-coordinator`. Install with `npm i @hexok/schedule-coordinator-redis`. Depends on `ioredis` 5 and `cron` 4.

```ts
import { RedisScheduleCoordinator } from '@hexok/schedule-coordinator-redis';

const jobs = new RedisScheduleCoordinator({ redis: 'redis://127.0.0.1:6379' });
await jobs.start();
jobs.register({
  name: 'cleanup',
  cron: '0 * * * *',
  onTick: async ({ signal }) => {
    if (signal.aborted) return;
  },
});
```

Cron is 5-field or 6-field. The time zone is UTC unless `timezone` is set. Missed ticks are not replayed. The lock TTL is 60 seconds. Renew and delete are atomic Lua scripts that run only when the value still matches this process. A lock miss or a thrown `SET` skips `onTick`. A failed renew aborts the tick signal. `stop()` aborts in-flight ticks and compare-and-deletes only locks this process still holds. `onTick` runs in-process. This package does not import `@hexok/queue`.
