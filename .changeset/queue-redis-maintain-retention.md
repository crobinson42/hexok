---
"@hexok/queue-redis": minor
---

`maintain()` takes `retentionMs` and trims only when it is given. It no longer uses the instance's `retentionMs`, which let one process shorten streams other services publish with longer retention. A `maintain()` that relied on the old trim must now pass `retentionMs`. Without it, `report.trimmed` is empty.
