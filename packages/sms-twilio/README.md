# @hexok/sms-twilio

Twilio adapter for `@hexok/sms`. Install with `npm i @hexok/sms-twilio`. `twilio` `^5` is an optional peer and is not imported.

`from` is adapter config. One recipient per call. `21610` is unsubscribed. `21608`, `21211`, and `21614` are invalid recipients. `20429` or HTTP 429 is rate limited with `retryAfterMs` 30000. Status `>= 500` or a missing status is unavailable with the same delay. Other 4xx responses are rejected. An optional `quarantine` sink parks `Unavailable` and `RateLimited`. Unsubscribed, invalid, and rejected sends are not parked. This package does not depend on `@hexok/quarantine`.

A failed send logs `sms: twilio send failed` with `{ code, status, attempt }`. The log holds no destination, body, or provider message. `Rejected` uses its catalog message. Twilio error messages can quote the destination number, so this is the default.

Set `exposeProviderErrors: true` to log the raw Twilio error and put its message in `Rejected`. Use it while you debug an integration, or when your log sink is cleared for phone numbers.

Set `sensitive: true` on a message that holds a one-time code. It always gets the default logging, even with `exposeProviderErrors`. When it is parked, the payload is `{ sensitive: true, bodyLength }`, with no `to` and no `body`. A non-sensitive message parks `{ to, body }` so it can be replayed.
