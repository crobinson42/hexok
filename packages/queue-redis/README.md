# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 5. Pass a structural logger and quarantine sink. This package does not depend on `@hexok/logger` or `@hexok/quarantine`.

```ts
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();
await queue.subscribe('emails', {
  consumerGroup: 'mailer',
  handler: async (message) => {
    await send(message.payload);
  },
});
await queue.publish('emails', { to: 'ada@example.com' });
await queue.stop();
```

## Guarantees

Delivery is at least once. A message can reach a handler more than once, so make handlers idempotent.

- An entry is acked with `XACK` only after its handler returns `'ack'`, `'drop'`, or nothing.
- An entry whose handler throws or returns `'retry'` stays pending. A thrown error follows the subscription's `onError`, which defaults to `'retry'`.
- After `visibilityMs`, `XAUTOCLAIM` in any consumer of the group claims a pending entry and delivers it again. A redelivery can arrive after newer entries.
- Every entry of a read batch is in the heartbeat from the moment the batch arrives until it settles. The heartbeat `XCLAIM`s those entries every `visibilityMs / 3`, so no consumer reclaims an entry that is running or waiting its turn. The heartbeat is `XCLAIM` with the ids and then `JUSTID`. An empty snapshot does not call `XCLAIM`. `'retry'` removes the id from the heartbeat, so the entry goes idle and can be reclaimed.
- `XAUTOCLAIM` runs every `visibilityMs / 2`. A run is skipped while the previous one is still running.
- A handler that finishes while `stop()` or `unsubscribe()` waits is acked. Once they stop waiting, a handler that returns does not `XACK`. Its entry stays pending for another consumer.
- A consumer is never deleted while it owns a pending entry. Deleting it would drop those entries from the group, and no consumer could reclaim them.
- When a group is deleted under a subscription, the read loop and `XAUTOCLAIM` recreate it. A failed recreate is logged, and the read loop backs off.
- A pending entry deleted from the stream, by trim or `XDEL`, is acked. Redis 7 drops it in `XAUTOCLAIM`. Redis 6.2 returns it as `nil` and keeps it pending, so the queue acks the consumer's pending entries that are gone from the stream.

Trimming can lose entries. `XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID` after each publish and every minute. Both may delete entries that are still pending.

There is no dead-letter stream. An optional `quarantine` sink parks a failed encode or `XADD`, a missing payload, and a decode failure. A handler `'drop'` is not parked. An encode failure rejects `publish` and does not call `XADD`. A failed age trim is logged and still resolves `publish` with the stream id. A missing payload or a decode failure is acked after it is parked.

## Lifecycle

`start()` opens the commands connection and resolves once it is ready. It connects a client made with `lazyConnect`. A `start()` during a pending start joins it. A `start()` after `stop()` or a failed start opens a new connection.

`state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.

`subscribe()` creates the group with `MKSTREAM` if it is missing, then opens a blocking connection for that subscription. Each subscription has its own blocking connection, heartbeat, and `XAUTOCLAIM`. A second `subscribe()` to the same topic and group rejects until the first is unsubscribed. A `subscribe()` whose group create finishes after `stop()` began rejects with `Stopped` and opens no connection.

`unsubscribe()` ends one subscription the way `stop()` ends them all. It stops the read and disconnects the blocking connection. It waits up to `stopTimeoutMs` for the subscription's handlers, including those `XAUTOCLAIM` dispatched, and acks those that finish. Then it removes the consumer when nothing is in flight. A `stop()` and a new `subscribe()` can run while it waits. `unsubscribe()` removes only its own subscription.

`stop()` does these steps within `stopTimeoutMs` in all, and always resolves:

1. It rejects a pending `start()` with `Stopped`. New calls reject with `Stopped`.
2. It clears every timer this package sets, stops every read, and disconnects each blocking connection.
3. It waits for in-flight handlers, including those `XAUTOCLAIM` dispatched, and acks those that finish.
4. It removes each consumer that has nothing in flight.
5. A command still pending rejects with `StoppedBeforeReply`.
6. It sends `QUIT` on the commands connection, and disconnects it if `QUIT` does not settle in the time left.

A handler that calls `unsubscribe()` on its own subscription, or `stop()`, is not waited for, since it would wait for itself. Its entry is not acked and stays pending for another consumer.

### Errors

Calls outside `start()` and `stop()` reject with a `LifecycleError`.

| Code | When |
| --- | --- |
| `NotStarted` | `publish()`, `subscribe()`, or `maintain()` before `start()`, or after a failed start. |
| `Starting` | `publish()`, `subscribe()`, or `maintain()` while `start()` is pending. |
| `Stopped` | A call during or after `stop()`. A `start()` that `stop()` cancelled. |
| `StoppedBeforeReply` | `stop()` stopped waiting before Redis replied to `publish()`, `subscribe()`, or `maintain()`. Redis may or may not have run it. A `publish()` that rejects this way is parked with `outcome: 'unknown'`. |
| `StartTimeout` | The commands connection was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | The commands connection ended before it was ready, such as when `retryStrategy` gives up. |

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the call order. Do not retry them. `StoppedBeforeReply` means Redis may or may not have run the command. The adapter is stopping, so do not retry on it. `StartTimeout` and `EndedBeforeReady` reject `start()` and close every connection. Call `start()` again, or exit and let the orchestrator restart the process.

Import `LifecycleError` from this package, or match on `error.code`. Matching on `code` also works across packages.

### Logs

Every log carries `adapter: 'queue'`. `connection` is `commands` or `blocking`, and appears only on a connection error or a failed Redis command. `topic` and `group` name the subscription. `id` is the stream entry id. `code` is the `LifecycleError` code.

| Event | Level | Fields |
| --- | --- | --- |
| A connection error | `error` | `adapter`, `connection`, and `topic`, `group` on a blocking connection |
| A connection that ended after `start()` | `error` | `adapter`, `connection`, and `topic`, `group` on a blocking connection |
| `QUIT` fails during `stop()` | `error` | `adapter`, `connection` |
| The stop cleanup threw | `error` | `adapter` |
| A failed `XREADGROUP`, `XCLAIM`, `XAUTOCLAIM`, group recreate, or consumer removal | `error` | `adapter`, `connection`, `topic`, `group` |
| A failed `XACK` | `error` | `adapter`, `connection`, `topic`, `group`, `id` |
| A failed age trim, after a publish or on the minute | `error` | `adapter`, `connection`, `topic` |
| A background command that `stop()` cut short | `warn` | the failed command's fields, plus `code` |
| `unsubscribe()` stopped waiting for handlers, and left the consumer for `maintain()` | `warn` | `adapter`, `connection`, `topic`, `group` |
| `unsubscribe()` stopped waiting for Redis to remove the consumer | `error` | `adapter`, `connection`, `topic`, `group` |
| A handler throws | `error` | `adapter`, `topic`, `group`, `id` |
| A payload fails to decode | `error` | `adapter`, `topic`, `group`, `id` |
| An `XINFO`, `XTRIM`, consumer removal, group destroy, or stream delete fails in `maintain()` | `error` | `adapter`, `connection`, `topic`, and `group` when it is about a group |
| The quarantine sink fails to park | `error` | `adapter` |

`NotStarted`, `Starting`, and `Stopped` from background work are not logged. An error returned to the caller, such as a failed `publish()` or a `maintain()` that `stop()` cut short, is not logged.

## When Redis is down

- During `start()`, ioredis retries, and each failed attempt is logged. Connection errors do not reject `start()`, so an app that boots before Redis waits for it. Set `startTimeoutMs` to fail instead.
- If `retryStrategy` gives up after `start()`, the connection ends and is logged at `error`. `state` stays `ready` and commands fail until `stop()` and `start()`. The default `retryStrategy` never gives up.
- During an outage, ioredis holds commands such as `XADD` and the group create in its offline queue. They wait for Redis. On `stop()`, a command queued that way rejects with `StoppedBeforeReply`.
- A read on a blocking connection that is reconnecting never settles in ioredis. `unsubscribe()` and `stop()` end it themselves.
- `unsubscribe()` stops waiting after `stopTimeoutMs`. When it stops waiting for handlers, it logs at `warn` and leaves the consumer for `maintain()`. When it stops waiting for Redis to remove the consumer, it logs an `error`, and `maintain()` removes the consumer later. If Redis runs the late removal, the script still keeps a consumer that owns entries.
- When the commands connection is not ready, `stop()` and `unsubscribe()` skip removing the consumer, and `stop()` skips `QUIT` and disconnects. `maintain()` removes a consumer left that way.
- When Redis is unreachable, the process can stay alive for the ioredis `disconnectTimeout` after `stop()` resolves. That is 2 seconds by default. Set `disconnectTimeout` in the `redis` options to shorten it.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options. Every connection uses it. `maxRetriesPerRequest` is `null`, so a command waits through an outage. Options you pass win. |
| `stopTimeoutMs` | `10000` | How long `stop()` and `unsubscribe()` wait for handlers, consumer removal, and `QUIT`. A handler still running is no longer waited for. It keeps running until the process exits, and its entry is not acked, so another consumer delivers it again after `visibilityMs`. So a stop shorter than `visibilityMs` is safe. |
| `startTimeoutMs` | unset | Unset, `start()` waits for Redis. Set it under an orchestrator, so `start()` rejects with `StartTimeout` and the process restarts. |
| `keyPrefix` | `'hexok:queue:'` | Each topic is the stream `<keyPrefix><topic>`. `maintain()` scans this prefix. |
| `visibilityMs` | `30000` | How long an entry stays with a consumer that stopped heartbeating. After it, `XAUTOCLAIM` delivers it again. |
| `batch` | `10` | Entries per `XREADGROUP` and `XAUTOCLAIM`. Handlers in a batch run one at a time. |
| `blockMs` | `1000` | How long one `XREADGROUP` blocks before it reads again. |
| `maxLen` | `10000` | The approximate `MAXLEN ~` cap per stream, applied on `XADD`. It keeps memory bounded. |
| `retentionMs` | `86400000` | Entries older than this are trimmed with `XTRIM MINID`, after each publish and every minute. One day by default. |
| `encode` | `JSON.stringify` | Turns a payload into the `payload` field. |
| `decode` | `JSON.parse` | Turns the `payload` field back. A failure parks the entry and acks it. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |
| `quarantine` | unset | A structural `ParkSink`, such as `@hexok/quarantine`. It receives what the queue cannot publish or deliver. |

On Kubernetes, a pod has `terminationGracePeriodSeconds` (30 by default) between `SIGTERM` and `SIGKILL`. An app stops its adapters one after another, so the server close plus every adapter's `stopTimeoutMs` must fit inside it. This adapter's default is 10000 ms.

Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.

## Sensitive messages

`publish(topic, payload, { sensitive: true })` adds a `sensitive` field to the entry. Other entries are unchanged. The handler still gets the payload.

- A failed encode or `XADD` parks `{ sensitive: true }` in place of the payload. Its parked error is `queue: encode failed` or `queue: XADD failed` with the original `name` and `code`.
- A failed encode rejects with `queue: encode failed` and the original `name` and `code`.
- A failed `XADD` rejects with a copy of the Redis error that keeps `name`, `message`, and `code`. It drops `command`, which holds the payload. A `LifecycleError` holds no payload and is thrown as it is.
- A sensitive entry that fails to decode parks no `raw`. Its log and parked error say only `queue: decode failed`.
- An error the handler throws is logged as thrown.

A parked record's `context` is `{ adapter: 'redis' }`. A `publish()` that rejects with `StoppedBeforeReply` is parked too, with `context` `{ adapter: 'redis', outcome: 'unknown' }`, since Redis may have stored it. A replay from quarantine can then deliver it twice.

## Maintenance

`maintain()` scans the key prefix. Run it from one cron.

- `dryRun` defaults to true and does not write. The report lists what a real run would do.
- `idleConsumerMs` removes `hexok:` consumers idle that long that own no pending entries. A consumer of another client is never removed.
- `dropIdleGroups` destroys a group only when it has no consumers, no pending entries, and a last-delivered id older than `idleMs`. That drops the cursor.
- `dropIdleStreams` deletes a key only when it has no groups and its last id is older than `idleMs`.
- `0-0` is never treated as old.
- `topics` limits the run to those topics instead of a scan.

The report lists what was trimmed, removed, destroyed, and deleted. It lists `stuck` groups whose pending entries have no consumer, or belong to an idle consumer. It lists `skipped` keys with a reason.

`maintain()` decides from `XINFO`, and Redis can change before it acts. Each removal is one Lua script that checks again and acts in one step. A consumer is removed only while `XPENDING` shows it owns no entry. A group is destroyed only while it has no consumers and nothing pending. A stream is deleted only while it has no groups and its last id is still old, measured on the Redis clock. What a script keeps, and what another run removed first, is not reported as removed, destroyed, or deleted, and is not logged. `unsubscribe()` and `stop()` use the same consumer script. A consumer kept with pending entries, such as one that returned `'retry'`, is left for `XAUTOCLAIM` or a later `maintain()`.

`stop()` interrupts `maintain()`, which then rejects with the `LifecycleError` code.
