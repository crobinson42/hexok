# @hexok/broadcast-redis

Redis pub/sub adapter for `@hexok/broadcast`. Install with `npm i @hexok/broadcast-redis`. This package does not depend on `@hexok/logger`.

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
- `unsubscribe()` never rejects with a lifecycle error.
- `publish()` awaits `PUBLISH`. An encode failure rejects and does not publish. `publish()` does not wait on handlers.
- A handler throw or rejection is logged, and sibling handlers still run.

## Lifecycle

`start()` opens a publisher and a subscriber connection and resolves once both are ready. It connects a client made with `lazyConnect`. A `start()` during a pending start joins it. A `start()` after `stop()` or a failed start opens new connections.

`state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.

`stop()` does these steps within `stopTimeoutMs` in all, and always resolves:

1. It rejects a pending `start()` with `Stopped`. New `publish()` and `subscribe()` calls reject with `Stopped`. It drops every handler, so subscribe again after the next `start()`.
2. It waits for in-flight `publish()`, `subscribe()`, and `unsubscribe()` commands. It sends no `UNSUBSCRIBE`, because `QUIT` ends the subscriptions.
3. A `publish()` or `subscribe()` still pending rejects with `StoppedBeforeReply`. An `unsubscribe()` still pending resolves.
4. It sends `QUIT` on the subscriber and the publisher together. It disconnects a connection that is not ready, or whose `QUIT` does not settle in the time left.

`stop()` does not wait for running handlers. A handler already called can finish after `stop()` resolves.

### Errors

`publish()`, `subscribe()`, and `start()` reject with a `LifecycleError`. Branch on `code`, not on the message. Message text can change in any release.

| Code | When |
| --- | --- |
| `NotStarted` | `publish()` or `subscribe()` before `start()`, or after a failed start. |
| `Starting` | `publish()` or `subscribe()` while `start()` is pending. |
| `Stopped` | `publish()` or `subscribe()` during or after `stop()`. A `start()` that `stop()` cancelled. |
| `StoppedBeforeReply` | `stop()` stopped waiting before Redis replied to `publish()` or `subscribe()`. Redis may or may not have run it. |
| `StartTimeout` | A connection was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | A connection ended before it was ready, such as when `retryStrategy` gives up. |

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the call order. Do not retry them. `StoppedBeforeReply` means Redis may or may not have run the command. The adapter is stopping, so do not retry on it. `StartTimeout` and `EndedBeforeReady` reject `start()` and close every connection. Call `start()` again, or exit and let the orchestrator restart the process.

Import `LifecycleError` from this package, or match on `error.code`. Matching on `code` also works across packages.

### Logs

Every entry carries `adapter: 'broadcast'`. `connection` is `publisher` or `subscriber`.

| Event | Level | Fields |
| --- | --- | --- |
| A connection error, such as a failed connect attempt during `start()` or an outage, or a connection that ended after `start()` | `error` | `adapter`, `connection` |
| `QUIT` fails during `stop()` | `error` | `adapter`, `connection` |
| A message fails to decode. The message is dropped. | `error` | `adapter`, `channel` |
| A handler throws or rejects | `error` | `adapter`, `channel` |

Errors returned to the caller are not logged. This adapter runs no background commands, so it logs no `StoppedBeforeReply`. An `unsubscribe()` that `stop()` cuts short is not logged, because closing the connection ends the subscription.

## When Redis is down

- During `start()`, ioredis retries and each failed attempt is logged. `start()` keeps waiting, so an app can boot before Redis is up. Set `startTimeoutMs` to fail instead. `start()` rejects with `EndedBeforeReady` when ioredis stops reconnecting. It then closes both connections, and a later `start()` tries again.
- If `retryStrategy` gives up after `start()`, the connection ends and is logged at `error`. `state` stays `ready` and commands fail until `stop()` and `start()`. The default `retryStrategy` never gives up.
- During an outage, ioredis holds `publish()`, `subscribe()`, and `unsubscribe()` in its offline queue until Redis returns. On `stop()`, a `publish()` or `subscribe()` queued that way rejects with `StoppedBeforeReply`, and an `unsubscribe()` resolves.
- With `enableOfflineQueue: false` in the `redis` options, a command during an outage fails at once instead. `subscribe()` right after `start()` still works, because `start()` waits for both connections.
- ioredis subscribes again after it reconnects. Messages published while the subscriber was disconnected are lost.
- A Redis that accepts connections and does not answer never replies to `QUIT`. The connection is disconnected when `stopTimeoutMs` runs out.
- After `stop()` resolves, ioredis can hold a half-closed socket to an unreachable Redis for its `disconnectTimeout`. That is 2 seconds by default, and it can keep the process alive. Set `disconnectTimeout` in the `redis` options to shorten it.

## Configuration

| Option | Default | Why |
| --- | --- | --- |
| `redis` | required | A URL or ioredis options for both connections. `maxRetriesPerRequest` is `null`, so a command waits through an outage. Options you pass win. |
| `stopTimeoutMs` | `1000` | The total time `stop()` may take. Pub/sub holds no state to drain, so stop only needs time for `QUIT`. |
| `startTimeoutMs` | unset | Unset, `start()` waits for Redis. Set it under an orchestrator, so `start()` rejects with `StartTimeout` and the process restarts. |
| `channelPrefix` | `'hexok:broadcast:'` | Redis pub/sub ignores the DB index, so the prefix keeps apps that share a Redis apart. |
| `encode` | `JSON.stringify` | Turns a payload into the message string. |
| `decode` | `JSON.parse` | Turns a message string into a payload. A decode failure is logged and the message is dropped. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |

On Kubernetes, a pod has `terminationGracePeriodSeconds` (30 by default) between `SIGTERM` and `SIGKILL`. An app stops its adapters one after another, so the server close plus every adapter's `stopTimeoutMs` must fit inside it. This adapter's default is 1000 ms.

Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.
