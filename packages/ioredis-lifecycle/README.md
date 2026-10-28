# @hexok/ioredis-lifecycle

Connection lifecycle for hexok Redis adapters built on ioredis. Redis adapters import it. App code does not: each adapter re-exports `LifecycleError`, so an app imports it from the adapter it uses. It holds no queue, broadcast, or schedule logic.

`ioredis` 5 is a peer dependency, because the lifecycle works on the adapter's own clients. Install with `npm i @hexok/ioredis-lifecycle ioredis`.

## Guarantees

- Every client has an `error` listener from the moment it opens. Errors go to the `LogSink` with `{ adapter, connection }`. ioredis does not print "Unhandled error event".
- Outside `stop()` cleanup, a guarded command runs only while the state is `ready`. Otherwise it rejects with `NotStarted`, `Starting`, or `Stopped`, and it does not run. During cleanup, `context.run` works while the state is `stopping`.
- A client that ends after `start()` is logged at `error`.
- `stop()` resolves within `stopTimeoutMs` while Redis refuses connections, stops answering, or the client is reconnecting.
- A guarded command still pending when `stop()` stops waiting rejects with `StoppedBeforeReply`. It does not hang.
- `stop()` clears every timer it made. It removes every `ready` and `abort` listener it added. Each client keeps its `error` listener, which still logs, and its `end` listener, which does nothing once the lifecycle stops.
- A settled guarded command leaves nothing behind. Its listeners belong to that call and are removed when it settles.
- `start()` works again after `stop()` or after a failed start. It opens new clients.

## Lifecycle

The states are `idle`, `starting`, `ready`, `stopping`, and `stopped`. A failed start returns to `idle`. Read `lifecycle.state` to add it to logs.

`state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.

`start(open, onReady?)` calls `open` to make the clients, then waits until each one is `ready`. It connects a client made with `lazyConnect`. A `start()` during a pending start joins it, and its `open` is not called. A `start()` while ready resolves at once. `onReady` runs once, when the state becomes `ready` and before `start()` resolves. Set adapter timers there, so two `start()` calls cannot set them twice. If `onReady` throws, the start fails.

`start()` rejects with:

- `EndedBeforeReady` when a client ends, such as when `retryStrategy` gives up.
- `StartTimeout` after `startTimeoutMs`.
- `Stopped` when `stop()` is called first, or when `stop()` has not finished.

After a failed start, every client is disconnected and a later `start()` begins clean.

`run(operation, command, options?)` runs `command` with the clients and returns its result. `operation` is the adapter method name, such as `publish`. It appears in error messages. The command's own error passes through unchanged. Pass `{ signal }` to end a command early with `signal.reason`, such as a blocking read on a client you are about to `detach()`. `assertReady(operation)` throws the same state errors synchronously, for a synchronous method.

`attach({ operation, connection, open, fields? })` opens one more client while ready, such as a blocking connection per subscription. Its errors are logged with `{ adapter, connection, ...fields }`, and `stop()` closes it. `detach(client)` disconnects it now without `QUIT`.

`stop(cleanup?)` does these steps in order, within one budget of `stopTimeoutMs`:

1. The state becomes `stopping`. New `run()` calls reject with `Stopped`. A pending `start()` rejects with `Stopped`.
2. When the lifecycle was ready, `cleanup` runs while in-flight commands finish. Cleanup runs commands with `context.run`, which works during stop. `context.signal` aborts when stop stops waiting.
3. Guarded commands still pending reject with `StoppedBeforeReply`.
4. Each ready client gets `QUIT` within the time left. A client that is not ready, or whose `QUIT` does not settle, is disconnected.
5. The state becomes `stopped`.

Cleanup runs before pending commands are rejected, because cleanup usually needs Redis, to release a lock or remove a consumer. In-flight commands get the same time to finish, so a healthy Redis answers them and their outcome is known. Cleanup does not run when `stop()` cancels a pending start. A `stop()` during a pending stop joins it, and its `cleanup` is not called. An error from `cleanup` is logged, and stop goes on.

### Errors

Every error is a `LifecycleError`, a hexok `Errors` catalog. Match on `code`. An error's `name` is `ioredis-lifecycle.<Code>`, such as `ioredis-lifecycle.StoppedBeforeReply`.

```ts
import { LifecycleError } from '@hexok/ioredis-lifecycle';

if (LifecycleError.is(error) && error.code === 'StoppedBeforeReply') {
  // Redis may or may not have run the command.
}
```

| Code | When |
| --- | --- |
| `NotStarted` | A command before `start()`, or after a failed start. |
| `Starting` | A command while `start()` is pending. |
| `Stopped` | A command during or after `stop()`. A `start()` that `stop()` cancelled. |
| `StoppedBeforeReply` | `stop()` stopped waiting before Redis replied. Redis may or may not have run the command. |
| `StartTimeout` | A client was not ready within `startTimeoutMs`. |
| `EndedBeforeReady` | A client ended before it was ready. |

Each message starts with the adapter name and says the fix, such as `queue: start() has not finished. Await start() before publish().`

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the call order. Do not retry them. `StoppedBeforeReply` means Redis may or may not have run the command. The adapter is stopping, so do not retry on it. `StartTimeout` and `EndedBeforeReady` reject `start()` and close every connection. Call `start()` again, or exit and let the orchestrator restart the process.

`LifecycleError.is` uses `instanceof`, so it matches only errors from the same copy of this package. Code that may see errors from several adapter versions should match on `error.code`.

### Logs

The lifecycle logs these through the `LogSink`. `fields` are the ones passed to `attach`.

| Event | Level | Fields |
| --- | --- | --- |
| A client emits `error`, such as a failed connection attempt | `error` | `adapter`, `connection`, `fields` |
| A client ends after `start()` | `error` | `adapter`, `connection`, `fields` |
| `QUIT` fails during `stop()` | `error` | `adapter`, `connection`, `fields` |
| `cleanup` throws during `stop()` | `error` | `adapter` |

Adapters follow four rules in their own logs:

- An adapter logs a `StoppedBeforeReply` from its own background commands at `warn`. It does not log `NotStarted`, `Starting`, or `Stopped` from background work. Errors returned to the caller are not logged by the adapter.
- A log of a `LifecycleError` carries its `code` as a field, such as `{ adapter, connection, code: 'StoppedBeforeReply' }`, so log queries filter on it without parsing messages.
- The `connection` field is present only on a connection error or a failed Redis command. A handler, job, or decode failure is user-code or data failure and carries no `connection`.
- Every adapter log carries `adapter`. Then `connection`, by the rule above, and the adapter's subject field: `topic` and `group` for the queue, `channel` for broadcast, and `job` for schedule.

## When Redis is down

- During `start()`, ioredis retries with its `retryStrategy`, and each failed attempt is logged. Without `startTimeoutMs`, `start()` waits until Redis returns. An app that boots before Redis then waits for it.
- If `retryStrategy` gives up after `start()`, the connection ends and is logged at `error`. `state` stays `ready` and commands fail until `stop()` and `start()`. The default `retryStrategy` never gives up.
- During an outage, ioredis holds commands in its offline queue. `openRedis` sets `maxRetriesPerRequest: null`, so they wait for Redis instead of failing after 20 attempts.
- `disconnect()` on a reconnecting client does not end it and does not flush its offline queue. ioredis would never settle those commands. The guard rejects them with `StoppedBeforeReply` when `stop()` stops waiting.
- A Redis that accepts connections and does not answer never replies to `QUIT`. The `QUIT` gets only the time left, and then the client is disconnected.
- After `stop()` resolves, ioredis can hold a half-closed socket to an unanswering Redis for `disconnectTimeout`. That is 2 seconds by default. Set `disconnectTimeout` in the redis options to let the process exit sooner.

## Configuration

`new RedisLifecycle(options)` takes:

| Option | Default | Why |
| --- | --- | --- |
| `adapter` | required | Prefixes every error message and is the `adapter` log field. |
| `stopTimeoutMs` | required | Each adapter knows how long its cleanup needs, such as waiting for handlers. The adapter sets and documents its default. |
| `startTimeoutMs` | unset | See below. |
| `logger` | no-op | A structural `LogSink`. `@hexok/logger` and `console` fit it. |

Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.

An invalid `stopTimeoutMs` or `startTimeoutMs` throws a `RangeError` that starts with the adapter name.

`openRedis(redis)` takes a URL or ioredis options and sets `maxRetriesPerRequest: null`. Options you pass win.

`sleep(ms, signal?)` resolves after `ms` or as soon as `signal` aborts. Use it for backoff. It never rejects and leaves no timer or listener.

## Writing an adapter

The adapter owns one `RedisLifecycle`. `start`, every command, and `stop` go through it.

```ts
import {
  LifecycleError,
  type LogSink,
  openRedis,
  RedisLifecycle,
} from '@hexok/ioredis-lifecycle';
import type { Redis, RedisOptions } from 'ioredis';

export interface RedisLockConfig {
  readonly redis: string | RedisOptions;
  /** Default 5000. */
  readonly stopTimeoutMs?: number;
  readonly logger?: LogSink;
}

const silent: LogSink = { debug() {}, info() {}, warn() {}, error() {} };

export class RedisLock {
  readonly #redis: string | RedisOptions;
  readonly #logger: LogSink;
  readonly #lifecycle: RedisLifecycle<{ commands: Redis }>;
  readonly #held = new Set<string>();
  #renew: ReturnType<typeof setInterval> | undefined;

  constructor(config: RedisLockConfig) {
    this.#redis = config.redis;
    this.#logger = config.logger ?? silent;
    this.#lifecycle = new RedisLifecycle({
      adapter: 'lock',
      stopTimeoutMs: config.stopTimeoutMs ?? 5000,
      logger: config.logger,
    });
  }

  start(): Promise<void> {
    return this.#lifecycle.start(
      () => ({ commands: openRedis(this.#redis) }),
      () => {
        this.#renew = setInterval(() => void this.#renewAll(), 10_000);
      },
    );
  }

  async acquire(key: string): Promise<boolean> {
    const set = await this.#lifecycle.run('acquire', ({ commands }) =>
      commands.set(key, 'me', 'PX', 30_000, 'NX'),
    );
    if (set === 'OK') this.#held.add(key);
    return set === 'OK';
  }

  stop(): Promise<void> {
    return this.#lifecycle.stop(async ({ run }) => {
      clearInterval(this.#renew);
      this.#renew = undefined;
      // `run` from the context works during stop. `this.#lifecycle.run` rejects with `Stopped`.
      await Promise.all(
        [...this.#held].map((key) =>
          run('release', ({ commands }) => commands.del(key)),
        ),
      );
      this.#held.clear();
    });
  }

  async #renewAll(): Promise<void> {
    for (const key of this.#held) {
      try {
        await this.#lifecycle.run('renew', ({ commands }) =>
          commands.pexpire(key, 30_000),
        );
      } catch (error) {
        this.#logRenewFailure(error, key);
      }
    }
  }

  /** Background work: a stop in progress is a `warn`, a call at the wrong time is not logged. */
  #logRenewFailure(error: unknown, key: string): void {
    if (LifecycleError.is(error)) {
      if (error.code === 'StoppedBeforeReply') {
        this.#logger.warn(error.message, {
          adapter: 'lock',
          connection: 'commands',
          code: error.code,
          key,
        });
      }
      return;
    }
    this.#logger.error(
      error instanceof Error ? error : new Error('lock: renew failed'),
      { adapter: 'lock', connection: 'commands', key },
    );
  }
}
```

A client per subscription goes through `attach`, and its reads take a signal so `detach` can end them:

```ts
const abort = new AbortController();
const blocking = this.#lifecycle.attach({
  operation: 'subscribe',
  connection: 'blocking',
  open: () => openRedis(this.#redis),
  fields: { topic },
});
const rows = await this.#lifecycle.run(
  'subscribe',
  () => blocking.xreadgroup('GROUP', group, consumer, 'BLOCK', 1000, 'STREAMS', key, '>'),
  { signal: abort.signal },
);

// On unsubscribe:
abort.abort(new Error('unsubscribed'));
this.#lifecycle.detach(blocking);
```
