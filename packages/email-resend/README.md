# @hexok/email-resend

Resend adapter for `@hexok/email`. Install with `npm i @hexok/email-resend`. `resend` `^6.10.0` is an optional peer and is not imported. The app passes a client. A `Resend` instance fits `ResendLike` without a cast.

`from` is the message from. Sandbox rewrites recipients to `delivered@resend.dev` and leaves `from` unchanged. `idempotencyKey` is the SDK option. Network errors, HTTP 429, status `>= 500`, and the names `rate_limit_exceeded`, `application_error`, and `internal_server_error` are retried with `p-retry`. Other 4xx responses are not retried. An optional `quarantine` sink parks `Unavailable` and `RateLimited` once retries stop. `Rejected` is not parked. This package does not depend on `@hexok/quarantine`.
