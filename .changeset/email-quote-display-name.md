---
"@hexok/email": patch
"@hexok/email-resend": patch
"@hexok/email-mailgun": patch
---

The Resend and Mailgun adapters send a `from.name` with an RFC 5322 special, such as `,`, `.`, `@`, or `<`, as a quoted-string with `"` and `\` escaped. Before, such a name broke or misparsed the From header. `assertEmailMessage` throws `InvalidHeader` for a `from.name` with a line break or NUL.
