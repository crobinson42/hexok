---
"@hexok/webhooks": minor
---

New package. `Webhooks` sends a hexok `EventCatalog`'s events to endpoints a product stores behind the `WebhookEndpoints` port, over any `Queue` adapter that supports `delayMs` and retry results. It signs Standard Webhooks payloads, checks every resolved address at connect time, retries eight times over about 27.5 hours with jitter and `Retry-After`, caps sends per endpoint, and calls typed hooks for delivery logs. `checkUrl`, `generateSecret`, and `sendTest` serve a product's endpoint form. `sign` and `verify` are exported for receivers.
