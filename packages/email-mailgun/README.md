# @hexok/email-mailgun

Mailgun adapter for `@hexok/email`. Install with `npm i @hexok/email-mailgun`. `mailgun.js` `^12` is an optional peer and is not imported. The app constructs the client.

There is no retry. Sandbox sets `o:testmode` to `yes` and omits the key otherwise. `idempotencyKey` is stored only as `v:idempotencyKey`. That is not provider dedupe, so a retry can double-send.
