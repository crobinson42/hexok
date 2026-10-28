# @hexok/email-resend

Resend adapter for `@hexok/email`. Install with `npm i @hexok/email-resend`. `resend` `^6.10.0` is an optional peer and is not imported. The app passes a client. A `Resend` instance fits `ResendLike` without a cast.

`from` is the message from. Attachments are sent as `content`, `filename`, and `contentType`. Sandbox rewrites recipients to `delivered@resend.dev` and leaves `from` unchanged. `idempotencyKey` is the SDK option. Network errors, HTTP 429, status `>= 500`, and the names `rate_limit_exceeded`, `application_error`, and `internal_server_error` are retried with `p-retry`. Other 4xx responses are not retried. An optional `quarantine` sink parks `Unavailable` and `RateLimited` once retries stop. `Rejected` is not parked. This package does not depend on `@hexok/quarantine`.

Errors are safe by default. `Rejected` carries its default message, because Resend's error text can hold the recipient address. The retry warning logs only the idempotency key, status, and attempt. Set `exposeProviderErrors: true` to put Resend's error text in `Rejected`. A `sensitive` message never exposes it.

Set `sensitive: true` on one-time codes, password resets, and magic links. Quarantine then parks `{ sensitive: true, recipientCount, attachmentCount }` and no addresses, subject, body, or tags. `recipientCount` counts `to`, `cc`, and `bcc`. The record keeps the idempotency key as its subject, the attempts, and the error. Other messages park in full.
