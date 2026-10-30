---
"@hexok/queue-redis": patch
"@hexok/broadcast-redis": patch
---

The default decode throws `queue: entry is not JSON` or `broadcast: message is not JSON` and does not quote the text. A malformed entry no longer puts the start of its contents into the log.
