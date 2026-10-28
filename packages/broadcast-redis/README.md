# @hexok/broadcast-redis

Redis pub/sub adapter for `@hexok/broadcast`. Install with `npm i @hexok/broadcast-redis`.

```ts
import { channel } from '@hexok/broadcast';
import { RedisBroadcast } from '@hexok/broadcast-redis';

const news = channel<{ ok: boolean }>('news');
const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
await bus.start();
await bus.publish(news, { ok: true });
```

`start()` opens a publisher and a subscriber connection and resolves once both are ready. It calls `connect()` on a client created with `lazyConnect`. A connection error is logged to `logger` and `start()` keeps waiting, so an app can boot before Redis is up. `start()` rejects when a connection ends, which means ioredis stopped reconnecting. It then closes both connections, and a later `start()` tries again. `stop()` rejects a pending `start()`.

A message published after `subscribe` resolves is delivered while the subscriber stays connected. A second `subscribe` to a channel waits for that channel's pending `SUBSCRIBE`. If `SUBSCRIBE` fails, `subscribe` rejects and the channel's handlers are removed. `publish` awaits `PUBLISH`. An encode failure rejects and does not publish. Delivery is at-most-once. A handler throw or rejection is logged and siblings still run. `publish` does not wait on handlers. The default channel prefix is `hexok:broadcast:` because Redis pub/sub ignores the DB index. `stop()` closes the subscriber and the publisher. It disconnects a connection that is not ready instead of waiting for Redis. When Redis is unreachable, the process can stay alive for the ioredis `disconnectTimeout` after `stop()` resolves. That is 2 seconds by default. Set `disconnectTimeout` in the `redis` options to shorten it. This package does not depend on `@hexok/logger`.
