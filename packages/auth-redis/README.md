# @hexok/auth-redis

Redis sessions for the `SessionStore` port of `@hexok/auth`. Install with `npm i @hexok/auth @hexok/auth-redis ioredis`. Connections run on `@hexok/ioredis-lifecycle`.

## Use

```ts
import { OpaqueSessionToken, Sessions, sessionConfig } from '@hexok/auth';
import { RedisSessionStore } from '@hexok/auth-redis';
import { z } from 'zod';

const store = new RedisSessionStore({
  redis: env.REDIS_URL,
  identity: z.object({ organizationId: z.string(), userId: z.string() }),
  ...sessionConfig(env),
});
await store.start();

const sessions = new Sessions({ store, token: new OpaqueSessionToken() });
```

`identity` is a Standard Schema of the identity's JSON form. It types the store, so `open` takes that shape and `resolve` returns it. `open` refuses an identity the schema refuses with a `VALIDATION` error. Every read is checked again. Use plain JSON values. A `Date` does not survive the round trip.

Start the store before the first call and stop it on shutdown. `Sessions` does not start or stop it.

## Records

Each session is one hash at `keyPrefix` plus a SHA-256 of the session id. Redis never holds the id a token carries, so read access to Redis does not yield a live credential.

| Field | Value |
| --- | --- |
| `i` | The identity as JSON. |
| `c` | When the session opened, in ms since the epoch. |
| `e` | The absolute end, in ms since the epoch. |
| `v` | The record version, `1`. |

The key's TTL is the idle window, never past the absolute end.

- `open` writes the hash and its TTL in one script. The id is 32 random bytes.
- `resolve` runs one script. A missing key is `ended`. A record past `e` is deleted and is `expired`. Otherwise the TTL becomes the lesser of the idle window and the time left, and the identity is returned.
- `resolve` compares `e` with the app clock, not the Redis clock. A Redis clock that runs ahead expires keys early. That reads as `ended`.
- A record that cannot be read, such as bad JSON, an identity the schema refuses, or a key of another type, is deleted, logged at `warn` with its key, and is `ended`.
- `close` deletes the key.

To debug a session, hash its id with `sessionKey(id, keyPrefix)`, then use `HGETALL`, `PTTL`, and `DEL`. A `PTTL` of `-2` means the key is gone. Redis cannot tell a deleted key from an expired one.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `redis` | required | A Redis URL or ioredis options. The store opens its own client. |
| `identity` | required | The identity's Standard Schema. |
| `idleSeconds`, `absoluteSeconds` | required | Both clocks. `sessionConfig(env)` from `@hexok/auth` reads them. |
| `keyPrefix` | `hexok:session:` | Every key starts with it. |
| `logger` | silent | A `LogSink`, such as `@hexok/logger` or `console`. |
| `startTimeoutMs` | unset | Rejects `start()` when Redis is not ready in time. |
| `stopTimeoutMs` | `5000` | The total time `stop()` may take. |

`state` is `ready` from `start()` until `stop()`, even while Redis is down. Use it to gate traffic, not as a Redis health check. A call outside that window rejects with a `LifecycleError`, which this package re-exports.

## ACL

This is the least-privilege user for this adapter. Replace `CHANGE_ME`.

```text
ACL SETUSER hexok-session on >CHANGE_ME resetchannels ~hexok:session:* -@all +hset +hmget +pexpire +del +eval +info +client|setinfo
```

The key pattern follows `keyPrefix`. `open` and `resolve` are scripts, and scripts run with this user's rights. So they need `+eval`, plus the `+hset`, `+hmget`, `+pexpire`, and `+del` they send. `close` sends `+del`.

- `+info` is the ioredis ready check, on every connection. `+client|setinfo` is the ioredis client tag. ioredis ignores a refused `CLIENT SETINFO`, but `ACL LOG` records each refusal.
- Redis 7.0 rejects `+client|setinfo` in `ACL SETUSER`, because it has no such subcommand. Remove that rule on 7.0.
- `HELLO`, `AUTH`, and `QUIT` need no rule. Redis does not check them against the ACL.
- Add `+select` when the URL names a database, and `+client|setname` when `connectionName` is set.

An integration test runs this line as a real user and fails if `ACL LOG` records a refusal.
