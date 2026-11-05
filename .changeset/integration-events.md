---
"@hexok/integration-events": minor
---

Add `@hexok/integration-events`. A `Contract` names a product's topics and versioned `Message` classes. `IntegrationPublisher` publishes them as CloudEvents envelopes through a `Queue`, with a downgraded copy for each earlier version. `IntegrationSubscriber` subscribes `EventHandler`s with one consumer group per service and handler.
