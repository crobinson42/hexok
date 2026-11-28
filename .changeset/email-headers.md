---
"@hexok/email": minor
"@hexok/email-resend": minor
"@hexok/email-mailgun": minor
---

`EmailMessage` takes `headers`, such as `In-Reply-To`, `References`, or `Auto-Submitted`. `assertEmailMessage` throws the new `EmailError.InvalidHeader` for a malformed name, a value with a line break or NUL, a repeated name, or a field the message already models. The Resend adapter sends `headers` as the SDK's `headers`. The Mailgun adapter sends them as `h:` fields. Quarantine parks headers except for a `sensitive` message.
