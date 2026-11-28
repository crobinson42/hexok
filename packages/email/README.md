# @hexok/email

Email port. Install with `npm i @hexok/email`. Adapters throw `EmailError`. They do not return `Result`.

```ts
import { assertEmailMessage, EmailSender, EmailError } from '@hexok/email';
```

`assertEmailMessage` throws `InvalidRecipient` when `to` is missing, empty, or only blank, `InvalidMessage` when both `text` and `html` are absent or blank, and `InvalidHeader` for a header it refuses. Sandbox is an adapter constructor flag, not a field on the message.

Set `sensitive: true` on a message that holds a secret, such as a one-time code, a password reset, or a magic link. An adapter then keeps recipients, subject, and body out of quarantine and logs.

`headers` adds header fields, such as `In-Reply-To` and `References` to thread a reply, or `Auto-Submitted: auto-replied` on an automatic acknowledgement. Each adapter sends them as given. `assertEmailMessage` refuses a name that is not printable ASCII without spaces or colons, a value with a line break or NUL, the same name twice in any case, and a field the message already models: `From`, `To`, `Cc`, `Bcc`, `Reply-To`, `Subject`, `Content-Type`, `Content-Transfer-Encoding`, and `MIME-Version`. The provider may refuse others.
