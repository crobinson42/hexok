# @hexok/webhooks

Outbound webhooks for hexok. Install with `npm i @hexok/webhooks`. Payloads and signatures follow [Standard Webhooks](https://www.standardwebhooks.com/).

## Signing

```ts
import { generateSecret, sign, verify, webhookId } from '@hexok/webhooks';

const secret = generateSecret(); // whsec_ and 32 random bytes
const id = webhookId(organizationId, eventId);
const signature = sign({ secret, id, timestamp, body });
const valid = verify({ secrets: [secret], id, timestamp: header, signature: header, body });
```

- `sign` returns `v1,` and the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`, keyed with the base64 part of the `whsec_` secret. `timestamp` is whole seconds.
- `verify` accepts a `webhook-signature` header of space-separated signatures, and a list of secrets. One match is enough, so a receiver accepts both secrets during a rotation. It checks lengths before `timingSafeEqual`. It returns false for a malformed header, a malformed timestamp, or a timestamp more than 5 minutes from now.
- `webhookId` is `msg_` and the first 26 hex characters of SHA-256 over `organizationId`, a NUL byte, and `eventId`. The same event gets the same id on every publish, so a receiver can dedupe on it. It never holds a dot.

## Sending

Each send is one `POST` with one deadline over DNS, connect, TLS, and the response body. It follows no redirect, so a 3xx fails. It keeps the first 20 KB of the response body.

The socket's `lookup` resolves the host and checks every address. A host with any address that is not public fails as `blocked`, and the connection goes only to an address that passed, so DNS rebinding cannot slip past. An IP literal, IPv4-mapped IPv6 included, is checked before connecting. A send opens its own connection and never reuses a pooled one.
