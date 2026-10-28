---
"@hexok/sms-twilio": minor
---

A failed send logs only `code`, `status`, and `attempt`, a failed park logs only the error `name`, and `Rejected` uses its catalog message. `exposeProviderErrors` restores the raw errors, except on a `sensitive` message, which parks `{ sensitive, bodyLength }` instead of `to` and `body`.
