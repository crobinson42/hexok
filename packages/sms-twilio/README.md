# @hexok/sms-twilio

Twilio adapter for `@hexok/sms`. Install with `npm i @hexok/sms-twilio`. `twilio` `^5` is an optional peer and is not imported.

`from` is adapter config. One recipient per call. `21610` is unsubscribed. `21608`, `21211`, and `21614` are invalid recipients. `20429` or HTTP 429 is rate limited with `retryAfterMs` 30000. Status `>= 500` or a missing status is unavailable with the same delay. Other 4xx responses are rejected.
