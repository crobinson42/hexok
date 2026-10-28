---
"@hexok/sms": minor
"@hexok/email": minor
"@hexok/queue": minor
---

`SmsMessage` and `EmailMessage` take `sensitive`. `Queue.publish` takes `{ sensitive }` as a third argument. An adapter keeps a sensitive message's content out of quarantine and logs.
