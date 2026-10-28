---
"@hexok/sms-twilio": minor
---

A failed send logs only `code`, `status`, and `attempt`, and `Rejected` uses its catalog message. `exposeProviderErrors` restores the raw provider error, except on a `sensitive` message, which parks `{ sensitive, bodyLength }` instead of `to` and `body`.
