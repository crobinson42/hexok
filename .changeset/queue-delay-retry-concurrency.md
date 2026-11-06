---
"@hexok/queue": major
---

`publish` takes `delayMs`, `subscribe` takes `concurrency`, and a handler may return `{ retryInMs, payload? }` to acknowledge the entry and publish its replacement after a delay, in one step. Every adapter must honour all three or throw. An adapter that cannot delay throws on `delayMs` and on a retry result.
