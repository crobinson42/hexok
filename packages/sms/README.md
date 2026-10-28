# @hexok/sms

SMS port. One recipient per `send`. Install with `npm i @hexok/sms`. Adapters throw `SmsError`.

```ts
import { SmsSender, SmsError } from '@hexok/sms';
```

A blank `to` is `InvalidRecipient`. An empty `body` is `Rejected`. `RateLimited` and `Unavailable` carry `{ retryAfterMs }`.

Set `sensitive: true` on a message that holds a secret, such as a one-time code. An adapter then keeps `to` and `body` out of quarantine and logs.
