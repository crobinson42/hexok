# @hexok/broadcast

At-most-once broadcast port. Install with `npm i @hexok/broadcast`. A Redis adapter is `@hexok/broadcast-redis`.

```ts
import { Broadcast } from '@hexok/broadcast';
```

`publish` resolves after the broker accepts the message. If nobody is subscribed, the message is gone. This is not a queue and not an event catalog.
