---
"@hexok/queue-redis": patch
---

`keptConsumers` holds the newest 1,000 consumers, so a long-running process no longer grows the list without limit. Each kept consumer is still logged at `warn`.
