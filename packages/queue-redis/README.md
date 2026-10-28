# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 5.

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
```

Pass a structural logger and quarantine sink. This package does not depend on `@hexok/logger` or `@hexok/quarantine`.

## Guarantees

Delivery is at least once. A message can reach a handler more than once, so make handlers idempotent.

- An entry is acked with `XACK` only after its handler returns `'ack'`, `'drop'`, or nothing.
- An entry whose handler throws or returns `'retry'` stays pending. A thrown error follows the subscription's `onError`, which defaults to `'retry'`. The error is logged as thrown.
- After `visibilityMs`, `XAUTOCLAIM` in any consumer of the group claims a pending entry and delivers it again. A redelivery can arrive after newer entries.
- While a handler runs, a heartbeat `XCLAIM`s its entry every `visibilityMs / 3`, so no other consumer reclaims it. The heartbeat is `XCLAIM` with the ids and then `JUSTID`. An empty snapshot does not call `XCLAIM`. `'retry'` removes the id from the heartbeat, so the entry goes idle and can be reclaimed.
- After `unsubscribe` or `stop()`, an in-flight handler does not `XACK`. Its entry stays pending for another consumer.
- A consumer is never deleted while it owns a pending entry. Deleting it would drop those entries from the group, and no consumer could reclaim them.
- When a group is deleted under a subscription, the read loop and `XAUTOCLAIM` recreate it. A failed recreate is logged with the `topic`, and the read loop backs off.

Trimming can lose entries. `XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID` after each publish and every minute. Both may delete entries that are still pending.

There is no dead-letter stream. An optional `quarantine` sink parks a failed encode or `XADD`, a missing payload, and a decode failure. A handler `'drop'` is not parked. An encode failure rejects `publish` and does not call `XADD`. A failed age trim is logged and still resolves `publish` with the stream id.

## Lifecycle

`start()` opens the commands connection and resolves once it is ready. It connects a client made with `lazyConnect`. A `start()` during a pending start joins it. A `start()` after `stop()` or a failed start opens a new connection.

`queue.state` is `idle`, `starting`, `ready`, `stopping`, or `stopped`. A failed start returns to `idle`. Read it in a readiness or health check, or add it to logs.

`subscribe()` creates the group with `MKSTREAM` if it is missing, then opens a blocking connection for that subscription. Each subscription has its own blocking connection, in-flight set, heartbeat, and `XAUTOCLAIM`. A second `subscribe()` to the same topic and group rejects until the first is unsubscribed.

`unsubscribe()` ends one subscription the way `stop()` ends them all. It stops the read and disconnects the blocking connection. It waits up to `stopTimeoutMs` for the subscription's handlers, including those `XAUTOCLAIM` dispatched. Then it removes the consumer, when nothing was in flight. A `stop()` and a new `subscribe()` can run while it waits. `unsubscribe()` removes only its own subscription.

`stop()` does these steps within `stopTimeoutMs` in all, and always resolves:

1. It rejects a pending `start()` with `Stopped`. New calls reject with `Stopped`.
2. It clears every timer this package sets, stops every read, and disconnects each blocking connection.
3. It waits for in-flight handlers, including those `XAUTOCLAIM` dispatched.
4. It removes each consumer that had nothing in flight.
5. A command still pending rejects with `StoppedBeforeReply`.
6. It sends `QUIT` on the commands connection, and disconnects it if `QUIT` does not settle in the time left.

A `subscribe()` whose group create finishes after `stop()` began rejects with `Stopped` and opens no connection. One whose group create never finishes rejects with `StoppedBeforeReply`.

Calls outside `start()` and `stop()` reject with a `LifecycleError`. Import it from this package and branch on `code`, not on the message. Message text can change in any release.

| Code | When |
| --- | --- |
| `NotStarted` | `publish()`, `subscribe()`, or `maintain()` before `start()`, or after a failed start. |
| `Starting` | `publish()`, `subscribe()`, or `maintain()` while `start()` is pending. |
| `Stopped` | A call during or after `stop()`. A `start()` that `stop()` cancelled. |
| `StoppedBeforeReply` | `stop()` stopped waiting before Redis replied to `publish()`, `subscribe()`, or `maintain()`. Redis may or may not have run it. |
| `StartTimeout` | The commands connection was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | The commands connection ended before it was ready, such as when `retryStrategy` gives up. |

```ts
import { LifecycleError } from '@hexok/queue-redis';

try {
  await queue.publish('emails', payload);
} catch (error) {
  if (LifecycleError.is(error) && error.code === 'StoppedBeforeReply') {
    // Redis may have stored it. A retry on a started queue is safe when handlers are idempotent.
  }
  throw error;
}
```

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the order. Do not retry them.

## When Redis is down

- During `start()`, ioredis retries, and each failed attempt goes to the logger. Connection errors do not reject `start()`, so an app that boots before Redis waits for it. Set `startTimeoutMs` to fail instead.
- Every connection error goes to the logger with `adapter: 'queue'` and `connection`, `commands` or `blocking`. A blocking connection's error also has its `topic` and `group`. A failed command is logged with the same fields.
- During an outage, ioredis holds commands such as `XADD` and the group create in its offline queue. They wait for Redis. On `stop()`, a command queued that way rejects with `StoppedBeforeReply`.
- A read on a blocking connection that is reconnecting never settles in ioredis. `unsubscribe()` and `stop()` end it themselves.
- `unsubscribe()` gives up on Redis after `stopTimeoutMs`. When it gives up on removing the consumer, it logs an error, and `maintain()` removes the consumer later. If Redis runs the late removal, the script still keeps a consumer that owns entries.
- When the commands connection is not ready, `stop()` and `unsubscribe()` skip removing the consumer, and `stop()` skips `QUIT` and disconnects. A consumer left that way is removed by `maintain()`.
- When Redis is unreachable, the process can stay alive for the ioredis `disconnectTimeout` after `stop()` resolves. That is 2 seconds by default. Set `disconnectTimeout` in the `redis` options to shorten it.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options. Every connection uses it. `maxRetriesPerRequest` is `null`, so a command waits through an outage. Options you pass win. |
| `keyPrefix` | `'hexok:queue:'` | Each topic is the stream `<keyPrefix><topic>`. `maintain()` scans this prefix. |
| `visibilityMs` | `30000` | How long an entry stays with a consumer that stopped heartbeating. After it, `XAUTOCLAIM` delivers it again. The heartbeat runs every third and `XAUTOCLAIM` every half of it. |
| `stopTimeoutMs` | `visibilityMs` | How long `stop()` and `unsubscribe()` wait for handlers, consumer removal, and `QUIT`. After `visibilityMs`, another consumer reclaims the entry, so waiting longer gains nothing. Keep it below the orchestrator's grace period. |
| `startTimeoutMs` | unset | Unset, `start()` waits for Redis, which suits a process that boots before Redis. Set it to fail fast under an orchestrator that restarts the process. |
| `batch` | `10` | Entries per `XREADGROUP` and `XAUTOCLAIM`. Handlers in a batch run one at a time. |
| `blockMs` | `1000` | How long one `XREADGROUP` blocks before it reads again. |
| `maxLen` | `10000` | The approximate `MAXLEN ~` cap per stream, applied on `XADD`. It keeps memory bounded. |
| `retentionMs` | `86400000` | Entries older than this are trimmed with `XTRIM MINID`, after each publish and every minute. One day by default. |
| `encode` | `JSON.stringify` | Turns a payload into the `payload` field. |
| `decode` | `JSON.parse` | Turns the `payload` field back. A failure parks the entry and acks it. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |
| `quarantine` | unset | A structural `ParkSink`, such as `@hexok/quarantine`. It receives what the queue cannot deliver. |

## Sensitive messages

`publish(topic, payload, { sensitive: true })` adds a `sensitive` field to the entry. Other entries are unchanged. The handler still gets the payload.

- A failed encode or `XADD` parks `{ sensitive: true }` in place of the payload. Its parked error is `queue: encode failed` or `queue: XADD failed` with the original `name` and `code`.
- A failed encode rejects with `queue: encode failed` and the original `name` and `code`.
- A failed `XADD` rejects with a copy of the Redis error that keeps `name`, `message`, and `code`. It drops `command`, which holds the payload. A `LifecycleError` holds no payload and is thrown as it is.
- A sensitive entry that fails to decode parks no `raw`. Its log and parked error say only `queue: decode failed`.
- An error the handler throws is logged as thrown.

## Maintenance

`maintain()` scans the key prefix. Run it from one cron.

- `dryRun` defaults to true and does not write. The report lists what a real run would do.
- `idleConsumerMs` removes `hexok:` consumers idle that long that own no pending entries. A consumer of another client is never removed.
- `dropIdleGroups` destroys a group only when it has no consumers, no pending entries, and a last-delivered id older than `idleMs`. That drops the cursor.
- `dropIdleStreams` deletes a key only when it has no groups and its last id is older than `idleMs`.
- `0-0` is never treated as old.
- `topics` limits the run to those topics instead of a scan.

The report lists what was trimmed, removed, destroyed, and deleted. It lists `stuck` groups whose pending entries have no consumer, or belong to an idle consumer. It lists `skipped` keys with a reason.

`maintain()`, `unsubscribe()`, and `stop()` remove a consumer with one Lua script. It deletes the consumer only when `XPENDING` shows it owns no entry. Otherwise it keeps it. One script closes the gap where a read still blocked in Redis hands the consumer an entry between the check and the delete. A consumer `maintain()` chose from `XINFO` that took an entry since is kept and is not reported as removed. A consumer kept with pending entries, such as one that returned `'retry'`, is left for `XAUTOCLAIM` or a later `maintain()`.

`stop()` interrupts `maintain()`, which then rejects with the `LifecycleError` code.
