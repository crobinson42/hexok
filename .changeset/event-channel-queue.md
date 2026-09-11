---
"hexok": minor
---

Catalog kind `broker` is now `queue` (`QueueAdapter`, `InMemoryQueue`). `EventChannel` + `.route(channel, adapter)` owns join, claim refresh, and fan-out to live sessions on a bus catalog. Presence is a `ChannelAdapter`; distribution stays `.bind(catalog, bus)`.
