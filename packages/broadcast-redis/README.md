# @hexok/broadcast-redis

Redis pub/sub adapter for `@hexok/broadcast`. Install with `npm i @hexok/broadcast-redis`.

```ts
import { channel } from '@hexok/broadcast';
import { RedisBroadcast } from '@hexok/broadcast-redis';

const news = channel<{ ok: boolean }>('news');
const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
await bus.start();
await bus.subscribe(news, (message) => console.log(message.payload));
await bus.publish(news, { ok: true });
await bus.stop();
```

## Guarantees

- Delivery is at-most-once. Redis pub/sub keeps no history.
- A message published after `subscribe()` resolves is delivered while the subscriber stays connected. `subscribe()` resolves once Redis confirms `SUBSCRIBE`.
- Await `subscribe()`. One that is not awaited can miss messages published right after it, and its failure is unhandled.
- A second `subscribe()` to a channel waits for that channel's pending `SUBSCRIBE`.
- If `SUBSCRIBE` fails, `subscribe()` rejects and the channel's handlers are removed.
- `unsubscribe()` removes the last handler of a channel and then sends `UNSUBSCRIBE`. It goes after any `SUBSCRIBE` already sent for that channel, so a later `subscribe()` is not undone.
- `publish()` awaits `PUBLISH`. An encode failure rejects and does not publish. `publish()` does not wait on handlers.
- A handler throw or rejection is logged, and sibling handlers still run.

## Lifecycle

`start()` opens a publisher and a subscriber connection and resolves once both are ready. It calls `connect()` on a client created with `lazyConnect`. A `start()` during a pending start joins it. A `start()` after `stop()` opens new connections.

`bus.state` is `idle`, `starting`, `ready`, `stopping`, or `stopped`. A failed start returns to `idle`. Read it in a readiness or health check, or add it to logs.

`stop()` rejects a pending `start()` with `Stopped`. It drops every handler, so subscribe again after the next `start()`. It sends no `UNSUBSCRIBE`, because `QUIT` ends the subscriptions. It closes the subscriber and the publisher together. Each ready connection gets `QUIT`, and is disconnected if `QUIT` does not settle within `stopTimeoutMs`. A connection that is not ready is disconnected instead of waiting for Redis. `stop()` always resolves.

`publish()` and `subscribe()` reject with a `LifecycleError` when called outside `start()` and `stop()`. Import it from this package and branch on `code`, not on the message.

| Code | When |
| --- | --- |
| `NotStarted` | `publish()` or `subscribe()` before `start()`, or after a failed start. |
| `Starting` | `publish()` or `subscribe()` while `start()` is pending. |
| `Stopped` | `publish()` or `subscribe()` during or after `stop()`. A `start()` that `stop()` cancelled. |
| `StoppedBeforeReply` | `stop()` stopped waiting before Redis replied to `publish()`, `subscribe()`, or `unsubscribe()`. Redis may or may not have run it. |
| `StartTimeout` | A connection was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | A connection ended before it was ready, such as when `retryStrategy` gives up. |

```ts
import { LifecycleError } from '@hexok/broadcast-redis';

try {
  await bus.publish(news, { ok: true });
} catch (error) {
  if (LifecycleError.is(error) && error.code === 'StoppedBeforeReply') {
    // Redis may have delivered it. Retry only when a second delivery is safe.
  }
  throw error;
}
```

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the order. Do not retry them.

## When Redis is down

- During `start()`, ioredis retries and each connection error is logged. `start()` keeps waiting, so an app can boot before Redis is up. Set `startTimeoutMs` to fail instead. `start()` rejects with `EndedBeforeReady` when ioredis stops reconnecting. It then closes both connections, and a later `start()` tries again.
- During an outage, ioredis holds `publish()`, `subscribe()`, and `unsubscribe()` in its offline queue until Redis returns. A command still queued when `stop()` stops waiting rejects with `StoppedBeforeReply`.
- With `enableOfflineQueue: false` in the `redis` options, a command during an outage fails at once instead. `subscribe()` right after `start()` still works, because `start()` waits for both connections.
- ioredis subscribes again after it reconnects. Messages published while the subscriber was disconnected are lost.
- A Redis that accepts connections and does not answer never replies to `QUIT`. The connection is disconnected when `stopTimeoutMs` runs out.
- After `stop()` resolves, ioredis can hold a half-closed socket to an unreachable Redis for its `disconnectTimeout`. That is 2 seconds by default, and it can keep the process alive. Set `disconnectTimeout` in the `redis` options to shorten it.

## Configuration

`new RedisBroadcast(config)` takes:

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options for both connections. `maxRetriesPerRequest` is `null`, so a command waits through an outage. Options you pass win. |
| `channelPrefix` | `hexok:broadcast:` | Redis pub/sub ignores the DB index, so the prefix keeps apps that share a Redis apart. |
| `encode` | `JSON.stringify` | Turns a payload into the message string. |
| `decode` | `JSON.parse` | Turns a message string into a payload. A decode failure is logged and the message is dropped. |
| `logger` | none | A structural `LogSink`. `@hexok/logger` and `console` fit it. This package does not depend on `@hexok/logger`. Connection errors carry `adapter: 'broadcast'` and `connection`, either `publisher` or `subscriber`. Decode and handler failures also carry `channel`. |
| `stopTimeoutMs` | `1000` | The total time `stop()` may take. Pub/sub holds no state to drain, so stop only needs time for `QUIT`. |
| `startTimeoutMs` | unset | Waiting suits a process that starts before Redis. Set it to fail fast, such as under an orchestrator that restarts the process. |
