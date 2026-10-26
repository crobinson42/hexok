# @hexok/broadcast

At-most-once broadcast port. Install with `npm i @hexok/broadcast`. A Redis adapter is `@hexok/broadcast-redis`.

```ts
import { type Broadcast, channel } from '@hexok/broadcast';

const news = channel<{ id: string }>('news');

declare const broadcast: Broadcast;
await broadcast.publish(news, { id: '1' });
await broadcast.subscribe(news, (message) => {
  message.payload.id;
});
```

`publish` resolves after the broker accepts the message. If nobody is subscribed, the message is gone. This is not a queue and not an event catalog.

Pass a `channel` token, not a raw string. The token's type parameter is the payload. Adapters publish `channel.name`. Import the same token to share a channel. Parse the payload in the subscriber. This port does not validate it.
