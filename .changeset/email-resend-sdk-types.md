---
"@hexok/email-resend": minor
---

`ResendLike` accepts the `Resend` client from `resend` without a cast. `ResendEmailPayload` requires `html` or `text`, as the SDK does. `send` passes `attachments` to Resend.

`Rejected` carries its default message instead of Resend's error text. Set `exposeProviderErrors: true` to keep the text. A `sensitive` message never exposes it and parks only counts.
