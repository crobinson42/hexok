---
"@hexok/integration-events": minor
---

`publish` validates each payload in the JSON form the queue carries and sends that form, so a `Date`, `bigint`, or other value that does not survive JSON fails at `publish` instead of at every consumer. `downgrade.map` receives the schema's output. A failed park makes the delivery throw, so the queue retries it instead of dropping it. A failed or concurrent `subscribe` leaves nothing half subscribed. Parked records carry `attempts`.
