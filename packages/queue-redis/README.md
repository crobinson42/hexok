# @hexok/queue-redis

Redis Streams adapter for `@hexok/queue`. Install with `npm i @hexok/queue-redis`. Requires Redis 6.2 or newer and `ioredis` 6. Connections negotiate RESP3 and keep v5 reply shapes. Pass a structural logger and quarantine sink. This package does not depend on `@hexok/logger` or `@hexok/quarantine`.

The adapter class is closed. Its fields and helpers are private. Wrap it in your own adapter of the port when you need extra logic.

```ts
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();
await queue.subscribe('emails', {
  consumerGroup: 'mailer',
  maxDeliveries: 'unlimited',
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
- An entry whose handler throws or returns `'retry'` stays pending, until `deliveries` reaches `maxDeliveries`. A thrown error follows the subscription's `onError`, which defaults to `'retry'`. `'ack'`, `void`, and `'drop'` still acknowledge on the last delivery. A retry at the ceiling is acknowledged. It is not a handler `'drop'`.
- `subscribe` requires `maxDeliveries`. There is no default. `'unlimited'` retries without a ceiling. A positive integer runs the handler at most that many times. The count is handoffs, not a duration. The default lease is 30 seconds. A restart consumes a count. Ten deliveries is not a promise of five minutes.
- `deliveries` is read from the pending list after each read or claim. It counts this handoff and every earlier handoff, including a crash that never acknowledged. A count past the ceiling does not call the handler. The entry is logged, parked when a sink is set, and acknowledged. A missing count is logged and left pending. It is not acknowledged.
- The ceiling is per subscriber. Two processes in one group can disagree during a deploy. The one that handles that delivery decides.
- After `visibilityMs`, `XAUTOCLAIM` in any consumer of the group claims a pending entry and delivers it again. A redelivery can arrive after newer entries.
- Every entry of a read batch is in the heartbeat from the moment the batch arrives until it settles. The heartbeat `XCLAIM`s those entries every `visibilityMs / 3`, so no consumer reclaims an entry that is running or waiting for a slot. The heartbeat is `XCLAIM` with the ids and then `JUSTID`. `JUSTID` does not increment the delivery count. Keep it. An empty snapshot does not call `XCLAIM`. `'retry'` removes the id from the heartbeat, so the entry goes idle and can be reclaimed.
- `XAUTOCLAIM` runs every `visibilityMs / 2`. A run is skipped while the previous one is still running. A run resumes at the cursor the last one left, and claims again while a full batch comes back, so a backlog of idle entries drains in one run instead of one batch per run. It ends on a short batch or when the scan wraps to the start.
- `concurrency` sets how many handlers of a subscription run at once. The default is 1. The read loop and `XAUTOCLAIM` share that many slots. A read or a claim asks only for free slots, up to `batch`, and holds none while it blocks. `stop()` and `unsubscribe()` wait for every running handler.
- A handler that finishes while `stop()` or `unsubscribe()` waits is acked. Once they stop waiting, a handler that returns does not `XACK`. Its entry stays pending for another consumer.
- A consumer is never deleted while it owns a pending entry. Deleting it would drop those entries from the group, and no consumer could reclaim them.
- When a group is deleted under a subscription, the read loop and `XAUTOCLAIM` recreate it. A failed recreate is logged, and the read loop backs off.
- A pending entry deleted from the stream, by trim or `XDEL`, is acked. Redis 7 drops it in `XAUTOCLAIM`. Redis 6.2 returns it as `nil` and keeps it pending, so the queue acks the consumer's pending entries that are gone from the stream.

### Delayed entries

`publish(topic, payload, { delayMs })` adds the entry to the sorted set `<delayedPrefix><topic>`, scored with its due time on the Redis clock, and resolves the member's id. It does not `XADD`. A script reads Redis `TIME`, so a publisher whose clock is ahead cannot make an entry due early. Omitted or 0 publishes now.

- A member is a random id, the `sensitive` flag, the group of a retry, and the encoded payload, so two identical payloads stay two entries.
- Every subscription runs one script every `promoteMs` that moves due members into the stream with `XADD … MAXLEN ~`, oldest first, at most 1,000 a run. Due is measured on the Redis clock. A due entry reaches a free slot within `promoteMs` plus `blockMs`.
- The script is atomic, so two subscriptions promoting the same topic move each member once.
- A run never fills the stream past 90% of `maxLen`, and skips while the stream is at that mark, so `MAXLEN ~` does not trim the entries it moves. `XLEN` counts acknowledged entries until the age trim removes them. Size `maxLen` and `retentionMs` so a busy stream stays under the mark, or delayed entries wait. A subscription logs an error after promote runs have found the stream at its mark for one minute, and again every minute it stays there.
- With `trim: false`, or on a topic no running instance publishes to, nothing removes acknowledged entries, so a stream at its mark stays there. Run `maintain({ retentionMs })` on such a topic.
- Only a subscription promotes. A delayed entry on a topic with no running subscriber waits in its set. It survives every restart, because it lives in Redis.

### Retry results

A handler may return `{ retryInMs, payload? }`. One script acks the entry and adds its replacement to the delayed set, due `retryInMs` from now on the Redis clock. A retry is never lost or doubled.

- The replacement goes only to the group that returned the result. It carries a `group` field, and every other group on the topic acks it without calling its handler or counting a delivery.
- The replacement carries `payload`, or the entry's own payload when it is omitted. It keeps the entry's `sensitive` flag. It is a new entry, so its delivery count starts at 1, and `maxDeliveries` does not count across it.
- When the entry is no longer pending, such as when another consumer acked it, the script adds nothing.
- A `retryInMs` that is not a finite number, zero or more, or a `payload` that fails to encode, counts as a handler throw and follows `onError`.
- Once `stop()` or `unsubscribe()` stops waiting, a handler that returns a retry result runs no script. Its entry stays pending for another consumer.
- A failed script is logged. The entry stays pending and is delivered again after `visibilityMs`.

Trimming can lose entries. `XADD` trims with `MAXLEN ~` only. Age trim is a separate `XTRIM MINID` after each publish and every minute, on the topics this instance published to. Both may delete entries that are still pending.

A consumer does not trim. A queue that only subscribes to a topic never trims that stream, so the publisher's retention decides how long entries stay. A stream with no running publisher is not age-trimmed. Run `maintain({ retentionMs })` for that.

There is no dead-letter stream. An optional `quarantine` sink parks a failed encode or `XADD`, a missing payload, a decode failure, and a give-up. A parked deliver record has `source: 'queue'`, `operation: 'deliver'`, and `subject` `topic:id`. Those three fields are the same for a missing payload, a decode failure, and a give-up. A give-up is the one whose error message is `queue: deliveries exhausted`, with `attempts` set to the count. A sensitive give-up parks no payload. A handler `'drop'` is not parked. Without a durable sink, acknowledging a give-up discards the entry. Quarantine has no replay method. A republish is a new entry, so its delivery count starts at 1. Trim can still delete a pending entry. The ceiling does not protect against that. An encode failure rejects `publish` and does not call `XADD`. A failed age trim is logged and still resolves `publish` with the stream id. A missing payload or a decode failure is acked after it is parked.

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

A handler that calls `unsubscribe()` on its own subscription, or `stop()`, is not waited for, since it would wait for itself. Its entry is not acked and stays pending for another consumer. The subscription's other handlers are waited for and acked.

### Kept consumers

`stop()` and `unsubscribe()` keep a consumer whose entries must not be lost, and leave it for `XAUTOCLAIM` or `maintain()`. Each kept consumer logs one `warn` with its `reason`, and `queue.keptConsumers` lists `{ topic, group, consumer, reason }` for the newest 1,000 consumers kept since the last `start()`. The `warn` log is the complete record.

| `reason` | Why the consumer stayed |
| --- | --- |
| `inflight` | A delivery was still in flight, such as a handler that called `stop()` itself. |
| `not_ready` | The commands connection was not ready, so the removal was not sent. |
| `pending` | The removal script found that the consumer owns a pending entry, such as one that returned `'retry'`. |
| `timeout` | The call stopped waiting for handlers after `stopTimeoutMs`. |

A failed removal is logged at `error` and is not listed, because Redis may have run it. The list records what happened at the call. `XAUTOCLAIM` or `maintain()` can resolve a consumer later, and the list does not change.

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
| A failed `XREADGROUP`, `XCLAIM`, `XAUTOCLAIM`, `XPENDING`, group recreate, or consumer removal | `error` | `adapter`, `connection`, `topic`, `group` |
| A failed `XACK` | `error` | `adapter`, `connection`, `topic`, `group`, `id` |
| A failed retry script | `error` | `adapter`, `connection`, `topic`, `group`, `id` |
| A failed promote script | `error` | `adapter`, `connection`, `topic`, `group` |
| Delayed entries held at the back-pressure mark for a minute, then every minute | `error` | `adapter`, `connection`, `topic`, `group`, `heldMs` |
| A failed age trim, after a publish or on the minute | `error` | `adapter`, `connection`, `topic` |
| A background command that `stop()` cut short | `warn` | the failed command's fields, plus `code` |
| `stop()` or `unsubscribe()` kept a consumer | `warn` | `adapter`, `connection`, `topic`, `group`, `consumer`, `reason` |
| `unsubscribe()` stopped waiting for Redis to remove the consumer | `error` | `adapter`, `connection`, `topic`, `group` |
| A handler throws | `error` | `adapter`, `topic`, `group`, `id` |
| Deliveries exhausted | `error` | `adapter`, `topic`, `group`, `id`, `deliveries` |
| A delivery count is missing | `error` | `adapter`, `topic`, `group`, `id` |
| A payload fails to decode | `error` | `adapter`, `topic`, `group`, `id` |
| An `XINFO`, `XTRIM`, consumer removal, group destroy, or stream delete fails in `maintain()` | `error` | `adapter`, `connection`, `topic`, and `group` when it is about a group |
| The quarantine sink fails to park | `error` | `adapter` |

`NotStarted`, `Starting`, and `Stopped` from background work are not logged. An error returned to the caller, such as a failed `publish()` or a `maintain()` that `stop()` cut short, is not logged.

## When Redis is down

- During `start()`, ioredis retries, and each failed attempt is logged. Connection errors do not reject `start()`, so an app that boots before Redis waits for it. Set `startTimeoutMs` to fail instead.
- If `retryStrategy` gives up after `start()`, the connection ends and is logged at `error`. `state` stays `ready` and commands fail until `stop()` and `start()`. The default `retryStrategy` never gives up.
- During an outage, ioredis holds commands such as `XADD` and the group create in its offline queue. They wait for Redis. On `stop()`, a command queued that way rejects with `StoppedBeforeReply`.
- A read on a blocking connection that is reconnecting never settles in ioredis. `unsubscribe()` and `stop()` end it themselves.
- `unsubscribe()` stops waiting after `stopTimeoutMs`. When it stops waiting for handlers, it logs at `warn` with reason `timeout` and leaves the consumer for `maintain()`. When it stops waiting for Redis to remove the consumer, it logs an `error`, and `maintain()` removes the consumer later. If Redis runs the late removal, the script still keeps a consumer that owns entries.
- When the commands connection is not ready, `stop()` and `unsubscribe()` skip removing the consumer and log at `warn` with reason `not_ready`, and `stop()` skips `QUIT` and disconnects. `maintain()` removes a consumer left that way.
- When Redis is unreachable, the process can stay alive for the ioredis `disconnectTimeout` after `stop()` resolves. That is 2 seconds by default. Set `disconnectTimeout` in the `redis` options to shorten it.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options. Every connection uses it. `maxRetriesPerRequest` is `null`, so a command waits through an outage. Options you pass win. |
| `stopTimeoutMs` | `10000` | How long `stop()` and `unsubscribe()` wait for handlers, consumer removal, and `QUIT`. A handler still running is no longer waited for. It keeps running until the process exits, and its entry is not acked, so another consumer delivers it again after `visibilityMs`. So a stop shorter than `visibilityMs` is safe. |
| `startTimeoutMs` | unset | Unset, `start()` waits for Redis. Set it under an orchestrator, so `start()` rejects with `StartTimeout` and the process restarts. |
| `keyPrefix` | `'hexok:queue:'` | Each topic is the stream `<keyPrefix><topic>`. `maintain()` scans this prefix. |
| `delayedPrefix` | `'hexok:queue-delayed:'` | Each topic's delayed entries are the sorted set `<delayedPrefix><topic>`. The default is outside `keyPrefix`, and `maintain()` skips these keys when a custom `keyPrefix` covers them. |
| `promoteMs` | `1000` | How often each subscription moves due delayed entries into its stream. |
| `visibilityMs` | `30000` | How long an entry stays with a consumer that stopped heartbeating. After it, `XAUTOCLAIM` delivers it again. |
| `batch` | `10` | The most entries one `XREADGROUP` or `XAUTOCLAIM` asks for. A call asks for fewer when fewer slots are free. |
| `blockMs` | `1000` | How long one `XREADGROUP` blocks before it reads again. |
| `maxLen` | `10000` | The approximate `MAXLEN ~` cap per stream, applied on `XADD`. It keeps memory bounded. |
| `retentionMs` | `86400000` | Entries older than this are trimmed with `XTRIM MINID`, after each publish and every minute, on the topics this instance published to. One day by default. `maintain()` does not use it. |
| `trim` | `'published'` | `'published'` age-trims only topics this instance published to. `false` never age-trims, and `MAXLEN ~` on `XADD` still applies. |
| `encode` | `JSON.stringify` | Turns a payload into the `payload` field. |
| `decode` | `JSON.parse` | Turns the `payload` field back. A bad entry throws `queue: entry is not JSON` and does not include the text. A failure parks the entry and acks it. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |
| `quarantine` | unset | A structural `ParkSink`, such as `@hexok/quarantine`. It receives what the queue cannot publish or deliver. |

On Kubernetes, a pod has `terminationGracePeriodSeconds` (30 by default) between `SIGTERM` and `SIGKILL`. An app stops its adapters one after another, so the server close plus every adapter's `stopTimeoutMs` must fit inside it. This adapter's default is 10000 ms.

Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.

## Redis ACL

This is the least-privilege user for this adapter. Replace `CHANGE_ME`.

```text
ACL SETUSER hexok-queue on >CHANGE_ME resetchannels ~hexok:queue:* ~hexok:queue-delayed:* -@all +xadd +xtrim +zadd +xgroup|create +xgroup|delconsumer +xgroup|destroy +xreadgroup +xack +xpending +xclaim +xautoclaim +xinfo|stream +xinfo|groups +xinfo|consumers +xrange +xlen +zrangebyscore +zrem +exists +eval +scan +time +del +info +client|setinfo
```

The key patterns follow `keyPrefix` and `delayedPrefix`. Scripts run with this user's rights, so the commands they send are listed too.

| Used by | Rules |
| --- | --- |
| `publish()` | `+xadd`, `+eval +time +zadd` with `delayMs`, and `+xtrim` unless `trim` is `false` |
| The promote script, in every subscription | `+eval +xlen +time +zrangebyscore +xadd +zrem` |
| The retry script, for a `{ retryInMs }` result | `+eval +xack +time +zadd` |
| `subscribe()`, reads, and acks | `+xgroup\|create +xreadgroup +xack +xpending +xclaim +xautoclaim` |
| Consumer removal script, in `stop()`, `unsubscribe()`, and `maintain()` | `+eval +exists +xinfo\|groups +xinfo\|consumers +xpending +xgroup\|delconsumer` |
| The script that acks entries gone from the stream, on Redis 6.2 | `+eval +xpending +xrange +xack` |
| `maintain()` | `+scan +xinfo\|stream +xinfo\|groups +xinfo\|consumers`, and `+xtrim` with `retentionMs` |
| `maintain()` group and stream scripts | `+eval +exists +xinfo\|groups +xinfo\|stream +xgroup\|destroy +time +del` |

A process with one role can drop the rest. `maintain()` is the only user of `+scan`, `+del`, `+xinfo|stream`, and `+xgroup|destroy`.

- `+info` is the ioredis ready check, on every connection. `+client|setinfo` is the ioredis client tag. ioredis ignores a refused `CLIENT SETINFO`, but `ACL LOG` records each refusal.
- Redis 7.0 rejects `+client|setinfo` in `ACL SETUSER`, because it has no such subcommand. Remove that rule on 7.0.
- `HELLO`, `AUTH`, and `QUIT` need no rule. Redis does not check them against the ACL.
- Add `+select` when the URL names a database, and `+client|setname` when `connectionName` is set.

An integration test runs this line as a real user and fails if `ACL LOG` records a refusal.

## Sensitive messages

`publish(topic, payload, { sensitive: true })` adds a `sensitive` field to the entry. Other entries are unchanged. The handler still gets the payload.

- A failed encode or `XADD` parks `{ sensitive: true }` in place of the payload. Its parked error is `queue: encode failed` or `queue: XADD failed` with the original `name` and `code`.
- A failed encode rejects with `queue: encode failed` and the original `name` and `code`.
- A failed `XADD` rejects with a copy of the Redis error that keeps `name`, `message`, and `code`. It drops `command`, which holds the payload. A `LifecycleError` holds no payload and is thrown as it is.
- A failed `ZADD` for a delayed publish, and a failed retry script, are scrubbed the same way for every entry, sensitive or not, before they are thrown or logged.
- A sensitive entry that fails to decode parks no `raw`. Its log and parked error say only `queue: decode failed`.
- An error the handler throws is logged as thrown.

A parked record's `context` is `{ adapter: 'redis' }`. A `publish()` that rejects with `StoppedBeforeReply` is parked too, with `context` `{ adapter: 'redis', outcome: 'unknown' }`, since Redis may have stored it. A replay from quarantine can then deliver it twice.

## Maintenance

`maintain()` scans the key prefix. Run it from one cron.

- `dryRun` defaults to true and does not write. The report lists what a real run would do.
- `retentionMs` trims each stream in the run to that age. Unset, `maintain()` does not trim. It comes from the call and not from this instance's `retentionMs`, because one cron scans streams that other services publish with their own retention. A cron usually publishes nothing, so limiting the trim to topics it published would trim nothing. Use `topics` to run it on streams that share a retention.
- `idleConsumerMs` removes `hexok:` consumers idle that long that own no pending entries. A consumer of another client is never removed.
- `dropIdleGroups` destroys a group only when it has no consumers, no pending entries, and a last-delivered id older than `idleMs`. That drops the cursor.
- `dropIdleStreams` deletes a key only when it has no groups and its last id is older than `idleMs`.
- `0-0` is never treated as old.
- `topics` limits the run to those topics instead of a scan.

The report lists what was trimmed, removed, destroyed, and deleted. It lists `stuck` groups whose pending entries have no consumer, or belong to an idle consumer. It lists `skipped` keys with a reason.

`maintain()` decides from `XINFO`, and Redis can change before it acts. Each removal is one Lua script that checks again and acts in one step. A consumer is removed only while `XPENDING` shows it owns no entry. A group is destroyed only while it has no consumers and nothing pending. A stream is deleted only while it has no groups and its last id is still old, measured on the Redis clock. What a script keeps, and what another run removed first, is not reported as removed, destroyed, or deleted, and is not logged. `unsubscribe()` and `stop()` use the same consumer script. A consumer kept with pending entries, such as one that returned `'retry'`, is left for `XAUTOCLAIM` or a later `maintain()`.

`stop()` interrupts `maintain()`, which then rejects with the `LifecycleError` code.
