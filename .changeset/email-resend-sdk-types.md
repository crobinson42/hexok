---
"@hexok/email-resend": minor
---

`ResendLike` accepts the `Resend` client from `resend` without a cast. `ResendEmailPayload` requires `html` or `text`, as the SDK does. `send` passes `attachments` to Resend.
