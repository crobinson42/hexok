# @hexok/queue

Queue port. Install with `npm i @hexok/queue`. A Redis Streams adapter is `@hexok/queue-redis`.

```ts
import { Queue, type QueueHandler } from '@hexok/queue';
```

`publish` resolves a broker id. `subscribe` requires `consumerGroup`. A handler return of `'ack'`, `void`, or `'drop'` acknowledges. `'retry'` leaves the entry pending. A throw uses `onError`, which defaults to `'retry'`. There is no dead-letter stream.
