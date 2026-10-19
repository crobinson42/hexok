# @hexok/email

Email port. Install with `npm i @hexok/email`. Adapters throw `EmailError`. They do not return `Result`.

```ts
import { assertEmailMessage, EmailSender, EmailError } from '@hexok/email';
```

`assertEmailMessage` throws `InvalidRecipient` when `to` is missing, empty, or only blank, and `InvalidMessage` when both `text` and `html` are absent or blank. Sandbox is an adapter constructor flag, not a field on the message.
