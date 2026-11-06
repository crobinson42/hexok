# @hexok/webhooks

## 0.1.0

### Minor Changes

- [#23](https://github.com/crobinson42/hexok/pull/23) [`db6f8f2`](https://github.com/crobinson42/hexok/commit/db6f8f2d2a4081c24bb5283923f402dea876fab9) Thanks [@crobinson42](https://github.com/crobinson42)! - New package. `Webhooks` sends a hexok `EventCatalog`'s events to endpoints a product stores behind the `WebhookEndpoints` port, over any `Queue` adapter that supports `delayMs` and retry results. It signs Standard Webhooks payloads, checks every resolved address at connect time, retries eight times over about 27.5 hours with jitter and `Retry-After` by default, with the schedule, attempts, jitter, `Retry-After` cap, retry rule, and response cap configurable and the schedule and attempts overridable per endpoint, caps sends per endpoint, and calls typed hooks for delivery logs. `checkUrl`, `generateSecret`, and `sendTest` serve a product's endpoint form. `sign` and `verify` are exported for receivers, and `verify` takes a `toleranceMs`.

### Patch Changes

- Updated dependencies [[`8f45f44`](https://github.com/crobinson42/hexok/commit/8f45f4450ae01cc9ac376d5ddf026cfa458be2bf)]:
  - @hexok/queue@2.0.0
