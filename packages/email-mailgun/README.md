# @hexok/email-mailgun

Mailgun adapter for `@hexok/email`. Install with `npm i @hexok/email-mailgun`. `mailgun.js` `^12`, `^13`, or `^14` is an optional peer and is not imported. The app constructs the client. A `mailgun.js` 14 client fits `MailgunLike` without a cast.

There is no retry. Sandbox sets `o:testmode` to `yes` and omits the key otherwise. `idempotencyKey` is stored only as `v:idempotencyKey`. That is not provider dedupe, so a retry can double-send. An optional `quarantine` sink parks `Unavailable` and `RateLimited`. `Rejected` is not parked. This package does not depend on `@hexok/quarantine`.

Errors are safe by default. A provider failure logs `email: mailgun send failed` with only the status and attempt. `Rejected` carries its default message, because Mailgun's error text can hold the recipient address. A failed park logs only the error name. Set `exposeProviderErrors: true` to put Mailgun's error text in `Rejected` and log raw provider and park errors. A `sensitive` message never exposes them.

Set `sensitive: true` on one-time codes, password resets, and magic links. Quarantine then parks `{ sensitive: true, recipientCount, attachmentCount }` and no addresses, subject, body, or tags. `recipientCount` counts `to`, `cc`, and `bcc`. The record keeps the idempotency key as its subject and the error. Other messages park in full. Do not build `idempotencyKey` from the recipient or the secret, because it appears in Mailgun's logs and in quarantine.
