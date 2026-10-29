---
"@hexok/queue": major
"@hexok/queue-redis": major
"hexok": patch
---

`subscribe` requires `maxDeliveries`. A positive integer runs the handler at most that many times. `'unlimited'` keeps retrying. A retry at the ceiling is acknowledged. The Redis adapter reads the pending delivery count and parks a give-up when a sink is set. A give-up is `source: 'queue'`, `operation: 'deliver'`, subject `topic:id`, and error `queue: deliveries exhausted`. Quarantine has no replay method. A republish is a new entry.
