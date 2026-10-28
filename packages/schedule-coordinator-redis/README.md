# @hexok/schedule-coordinator-redis

Per-job Redis lock for `@hexok/schedule-coordinator`. Install with `npm i @hexok/schedule-coordinator-redis`. Depends on `ioredis` 5 and `cron` 4. `lockTtlSec` is in seconds, unlike the `*Ms` options, and the adapter name in errors and logs is `schedule`.

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

- Each tick takes a lock in Redis with `SET NX`, a TTL of `lockTtlSec`, and a random token for that acquisition. Only the process that gets the lock runs `onTick`. A lock miss or a thrown `SET` skips `onTick`.
- The lock is renewed every third of the TTL while `onTick` runs. Renew and delete are atomic Lua scripts that run only when the token still matches. A process never extends or deletes another process's lock, and a late renew or release from an earlier tick never touches a later lock.
- The tick signal aborts when the lock is lost or unconfirmed: a renew finds the lock gone, a renew fails, or the lock is not renewed in time. A lock is valid until the TTL after its last `SET` or renew was sent. The tick aborts a margin of `min(1000, TTL / 4)` ms before that, so it stops before another process can take the lock, even with some timer lag.
- While a tick winds down after `stop()`, it keeps its lock. No other process runs the job until the tick finishes or `stopTimeoutMs` runs out.

The lock does not guarantee:

- At most one runner outside the lock. An `onTick` that ignores its signal keeps running after the lock is lost or released, and another process can then run the same job. Return when `signal` aborts.
- One run per scheduled time. The lock covers a running tick, not a scheduled time. Each process fires on its own clock, so a job that finishes before another process's clock reaches the same tick runs again there. Keep clocks in sync, or make `onTick` idempotent.
- A run for every scheduled time. A tick that no process can lock, such as while Redis is down, is skipped.

## Lifecycle

`start()` opens one Redis connection and resolves once Redis is ready. Await it before `register()`. A `start()` during a pending start joins it. A `start()` after `stop()` or a failed start opens a new connection. `register()` is synchronous. It throws `NotStarted`, `Starting`, or `Stopped` outside `start()` and `stop()`, and it throws when the name is already registered.

`state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.

`stop()` does these steps within `stopTimeoutMs`, and always resolves:

1. The state becomes `stopping`. Every cron job stops, so no new tick begins.
2. Each running tick's signal aborts, and its `warnAfterMs` timer stops.
3. `stop()` waits for running ticks, up to `stopTimeoutMs` less a reserve of `min(1000, stopTimeoutMs / 4)` ms for the releases. A tick keeps renewing its lock while it winds down, and releases the lock when it finishes.
4. Each lock still held is released with a compare-and-delete. A tick that ignores its signal keeps its lock until this release.
5. The connection closes.

A tick whose `SET` was still in flight does not run `onTick`, and its lock is released. `stop()` called from inside `onTick` does not wait for that tick. No timer outlives `stop()` unless a tick is still running when `stopTimeoutMs` runs out. After `stop()`, register the jobs again after the next `start()`.

### Errors

`register()` and `start()` throw or reject with a `LifecycleError`. Branch on `code`, not on the message. Message text can change in any release.

| Code | When |
| --- | --- |
| `NotStarted` | `register()` before `start()`, or after a failed start. |
| `Starting` | `register()` while `start()` is pending. |
| `Stopped` | `register()` during or after `stop()`. A `start()` that `stop()` cancelled, or a `start()` before `stop()` has finished. |
| `StoppedBeforeReply` | A tick's lock command was still pending when `stop()` stopped waiting. It is logged, not thrown. |
| `StartTimeout` | `start()` when Redis was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | `start()` when the connection ended first, such as when `retryStrategy` gives up. |

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the call order. Do not retry them. `StoppedBeforeReply` means Redis may or may not have run the command. The adapter is stopping, so do not retry on it. `StartTimeout` and `EndedBeforeReady` reject `start()` and close every connection. Call `start()` again, or exit and let the orchestrator restart the process.

Import `LifecycleError` from this package, or match on `error.code`. Matching on `code` also works across packages.

### Logs

Every log carries `adapter: 'schedule'`. `connection` is `commands`, and appears only on a connection error or a failed Redis command. `job` is the job name. `code` is the `LifecycleError` code.

| Event | Level | Fields |
| --- | --- | --- |
| A connection error, or a connection that ended after `start()` | `error` | `adapter`, `connection` |
| A lock `SET`, renew, or release failed | `error` | `adapter`, `connection`, `job` |
| A lock command that `stop()` cut short | `warn` | `adapter`, `connection`, `job`, `code` |
| The lock `SET` was answered too late to run the tick, so the lock was released | `warn` | `adapter`, `connection`, `job` |
| The lock was not renewed in time, so the tick was aborted | `warn` | `adapter`, `connection`, `job` |
| The lock was gone at renew, so the tick was aborted | `warn` | `adapter`, `job` |
| `onTick` throws | `error` | `adapter`, `job` |
| A tick runs longer than `warnAfterMs` | `warn` | `adapter`, `job`, `warnAfterMs` |
| Another process holds the lock, so the tick was skipped | `debug` | `adapter`, `job` |
| `QUIT` fails during `stop()` | `error` | `adapter`, `connection` |
| The stop cleanup throws | `error` | `adapter` |

`NotStarted`, `Starting`, and `Stopped` from background work are not logged. Errors thrown to the caller, from `start()` and `register()`, are not logged.

## When Redis is down

- During `start()`, ioredis retries, and each failed attempt is logged. Without `startTimeoutMs`, `start()` waits until Redis returns.
- If `retryStrategy` gives up after `start()`, the connection ends and is logged at `error`. `state` stays `ready` and commands fail until `stop()` and `start()`. The default `retryStrategy` never gives up.
- During an outage, a tick's `SET` waits in the ioredis offline queue. When Redis answers, the tick runs only if it got the lock and the lock is still valid with its margin. A `SET` answered later than the TTL less the margin releases the lock and skips the tick.
- A tick whose renews do not answer aborts before its lock can expire, because another process may take the lock then.
- `stop()` resolves within `stopTimeoutMs` while Redis refuses connections, stops answering, or the client is reconnecting. Commands still pending are logged with `StoppedBeforeReply`.
- A lock that `stop()` could not release expires after `lockTtlSec`. That is safe. The lock only holds other processes off this job until then. It never makes a job run twice, and the next tick after it expires runs normally.
- A Redis that accepts connections and does not answer never replies to `QUIT`. `QUIT` gets only the time left, and then the connection is dropped.
- After `stop()` resolves, ioredis can keep the process alive for `disconnectTimeout`, 2 seconds by default, while it closes the socket. Set `disconnectTimeout` in the redis options to let the process exit sooner.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options. `maxRetriesPerRequest` is `null` unless you set it, so a command waits through an outage instead of failing after 20 retries. |
| `stopTimeoutMs` | `5000` | Releasing locks takes a few round trips, and a lock left behind expires after `lockTtlSec` anyway. Most of it goes to running ticks, so they can finish while they hold their locks. |
| `startTimeoutMs` | unset | Unset, `start()` waits for Redis. Set it under an orchestrator, so `start()` rejects with `StartTimeout` and the process restarts. |
| `keyPrefix` | `hexok:sched:` | The lock key is `<keyPrefix>lock:<name>`. Processes that share a prefix share locks. |
| `lockTtlSec` | `60` | How long a lock outlives a process that dies or loses Redis. Shorter frees a lock sooner. Longer tolerates longer stalls. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |
| `scheduler` | `CronPackageScheduler` | Runs the cron. Its `stop()` resolves once a running tick has finished. Pass your own to fire ticks by hand in tests. |

On Kubernetes, a pod has `terminationGracePeriodSeconds` (30 by default) between `SIGTERM` and `SIGKILL`. An app stops its adapters one after another, so the server close plus every adapter's `stopTimeoutMs` must fit inside it. This adapter's default is 5000 ms.

Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.
