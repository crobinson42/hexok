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

`publish` awaits `PUBLISH`. An encode failure rejects and does not publish. Delivery is at-most-once. A handler throw or rejection is logged and siblings still run. `publish` does not wait on handlers. The default channel prefix is `hexok:broadcast:` because Redis pub/sub ignores the DB index. `stop()` closes the subscriber and the publisher. This package does not depend on `@hexok/logger`.
