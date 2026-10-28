---
"@hexok/email-mailgun": minor
---

A provider failure logs its status and attempt. `Rejected` carries its default message instead of Mailgun's error text. Set `exposeProviderErrors: true` to keep the text and log the raw error. A `sensitive` message never exposes it and parks only counts. A failed park logs only the error name.
