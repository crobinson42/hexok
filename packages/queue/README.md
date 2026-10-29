# @hexok/queue

Queue port. Install with `npm i @hexok/queue`. A Redis Streams adapter is `@hexok/queue-redis`.

```ts
import { Queue, type QueueHandler } from '@hexok/queue';
```

`publish` resolves a broker id. `subscribe` requires `consumerGroup` and `maxDeliveries`. There is no default. A positive integer runs the handler at most that many times. `'unlimited'` retries without a ceiling. `deliveries` on the message is the 1-based handoff count, including a crash that never acknowledged. It is stored with the entry, not in the process. A handler return of `'ack'`, `void`, or `'drop'` acknowledges, including on the last delivery. `'retry'` leaves the entry pending until the ceiling. A throw uses `onError`, which defaults to `'retry'`. A retry at the ceiling is acknowledged. It is not a handler `'drop'`. There is no dead-letter stream. A Redis adapter can park a failed publish, a missing payload, a decode failure, or a give-up when a quarantine sink is passed. A handler `'drop'` is not parked. Without a durable sink, a give-up discards.

Pass `{ sensitive: true }` as the third `publish` argument for a payload that holds a secret, such as a one-time code or a reset link. An adapter then parks and logs that message without its payload.
