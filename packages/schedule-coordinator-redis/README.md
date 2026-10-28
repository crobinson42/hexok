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

// On shutdown:
await jobs.stop();
```

Cron is 5-field or 6-field. The time zone is UTC unless `timezone` is set. Missed ticks are not replayed. With the default scheduler, later ticks of a job are skipped while one of its ticks runs. `onTick` runs in-process. This package does not import `@hexok/queue`.

## Guarantees

- Each tick takes a lock in Redis with `SET NX` and a TTL of `lockTtlSec`. Only the process that gets the lock runs `onTick`. A lock miss or a thrown `SET` skips `onTick`.
- The lock is renewed every half TTL while `onTick` runs. Renew and delete are atomic Lua scripts that run only when the value still matches this process. A process never extends or deletes another process's lock.
- The tick signal aborts when the lock is lost or unconfirmed: a renew finds the lock gone, a renew fails, or a renew has not answered by the next renew, when the lock may have expired.
- The lock is released when `onTick` finishes, or by `stop()`.

The lock does not guarantee:

- At most one runner outside the lock. An `onTick` that ignores its signal keeps running after the lock is lost or released, and another process can then run the same job. Return when `signal` aborts.
- One run per scheduled time. The lock covers a running tick, not a scheduled time. Each process fires on its own clock, so a job that finishes before another process's clock reaches the same tick runs again there. Keep clocks in sync, or make `onTick` idempotent.
- A run for every scheduled time. A tick that no process can lock, such as while Redis is down, is skipped.

## Lifecycle

`start()` opens one Redis connection and resolves once Redis is ready. Await it before `register()`. A `start()` while one is pending joins it.

`register()` is synchronous. It throws a `LifecycleError` with code `NotStarted` before `start()`, `Starting` while `start()` is pending, and `Stopped` after `stop()`. A name already registered throws.

`stop()` does these steps within `stopTimeoutMs`, and always resolves:

1. Every cron job stops, so no new tick begins.
2. Each running tick's signal aborts, and its renew and `warnAfterMs` timers stop.
3. Each lock this process holds is released with a compare-and-delete.
4. `stop()` waits for running ticks to finish.
5. The connection closes.

Locks are released before ticks finish, so a tick that ignores its signal does not keep its lock past `stop()`. Once `stop()` begins, a running tick sends nothing more to Redis. A tick whose `SET` was still in flight does not run `onTick`, and `stop()` releases its lock. A tick that ignores its signal holds `stop()` until `stopTimeoutMs`. No timer outlives `stop()` unless a tick is still running when `stopTimeoutMs` runs out.

`start()` works again after `stop()`. Register the jobs again after it resolves.

`state` is `idle`, `starting`, `ready`, `stopping`, or `stopped`. A failed start returns to `idle`. It suits a readiness or health check.

### Errors

Lifecycle errors are a `LifecycleError`, imported from this package. Branch on `code`, not on the message.

```ts
import { LifecycleError } from '@hexok/schedule-coordinator-redis';

try {
  jobs.register(job);
} catch (error) {
  if (LifecycleError.is(error) && error.code === 'NotStarted') {
    // Await jobs.start() before register().
  }
  throw error;
}
```

| Code | When |
| --- | --- |
| `NotStarted` | `register()` before `start()`, or after a failed start. |
| `Starting` | `register()` while `start()` is pending. |
| `Stopped` | `register()` during or after `stop()`. A `start()` that `stop()` cancelled. A `start()` while `stop()` has not finished. |
| `StartTimeout` | `start()` when Redis was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | `start()` when the connection ended first, such as when `retryStrategy` gives up. |
| `StoppedBeforeReply` | A tick's lock command was still pending when `stop()` stopped waiting. It is logged, not thrown. |

Tick failures go to the `logger`, not to the caller. Each log has `{ adapter: 'schedule', connection: 'commands', job }`. Connection errors have `{ adapter: 'schedule', connection: 'commands' }`.

## When Redis is down

- During `start()`, ioredis retries, and each failed attempt is logged. Without `startTimeoutMs`, `start()` waits until Redis returns.
- During an outage, a tick's `SET` waits in the ioredis offline queue. The tick runs if it gets the lock once Redis answers.
- A renew that waits for half the TTL aborts the tick, because the lock may have expired and another process may hold it.
- `stop()` resolves within `stopTimeoutMs` while Redis refuses connections, stops answering, or the client is reconnecting. Commands still pending are logged with `StoppedBeforeReply`.
- A lock that `stop()` could not release expires after `lockTtlSec`. That is safe. The lock only holds other processes off this job until then. It never makes a job run twice, and the next tick after it expires runs normally.
- A Redis that accepts connections and does not answer never replies to `QUIT`. `QUIT` gets only the time left, and then the connection is dropped.
- After `stop()` resolves, ioredis can keep the process alive for `disconnectTimeout`, 2 seconds by default, while it closes the socket. Set `disconnectTimeout` in the redis options to let the process exit sooner.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options. `maxRetriesPerRequest` is `null` unless you set it, so a command waits through an outage instead of failing after 20 retries. |
| `keyPrefix` | `hexok:sched:` | The lock key is `<keyPrefix>lock:<name>`. Processes that share a prefix share locks. |
| `lockTtlSec` | `60` | How long a lock outlives a process that dies or loses Redis. It is renewed every half TTL. Shorter frees a lock sooner. Longer tolerates longer stalls. |
| `stopTimeoutMs` | `5000` | Releasing locks takes a few round trips, and a lock left behind expires after `lockTtlSec` anyway. It also bounds the wait for running ticks. Keep it below the orchestrator's grace period. |
| `startTimeoutMs` | unset | Waiting suits a process that starts before Redis. Set it to fail fast, such as behind a health check. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |
| `scheduler` | `CronPackageScheduler` | Runs the cron. Its `stop()` resolves once a running tick has finished. Pass your own to fire ticks by hand in tests. |
