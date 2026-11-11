# @hexok/auth-jose

Signed session tokens for the `SessionToken` port of `@hexok/auth`, on [`jose`](https://github.com/panva/jose). Install with `npm i @hexok/auth @hexok/auth-jose jose`.

## Use

```ts
import { Sessions } from '@hexok/auth';
import { JoseSessionToken, joseConfig } from '@hexok/auth-jose';

const token = new JoseSessionToken(joseConfig(env));
const sessions = new Sessions({ store, token });
```

A token is a JWT that names a session and nothing about the person. The store still decides: a valid token whose session is gone is refused as `ended`.

| Part | Value |
| --- | --- |
| Header | `alg: HS256`, `typ: session+jwt`, and `kid`, the first 16 hex characters of a SHA-256 of the signing secret. |
| `jti` | The session id. |
| `iss`, `aud` | From config. |
| `iat` | When the token was issued. |
| `exp` | The session's absolute end. |

There are no other claims. Anyone holding a token can read its payload, so it carries no identity, email, or role.

`read` verifies the token before the store is asked. It requires `HS256`, the configured `typ`, `iss`, and `aud`, and both `jti` and `exp`. It allows a few seconds of clock skew. An authentic token past `exp` is `expired`. Anything else is `invalid`: garbage, a bad signature, `alg: none`, another algorithm, an unknown `kid`, or a missing claim. jose checks the signature before the claims, so only an authentic token reads as `expired`.

## Secrets

Secrets are base64url and decode to at least 32 bytes. `generateSecret()` returns 32 random bytes. Do not derive a secret from a password.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

`secrets` lists them newest first. The first signs. Each verifies the tokens whose `kid` matches it. To rotate, put a new secret first and keep the old one until the last token it signed passes its absolute end. Then remove it.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `secrets` | required | HMAC secrets, newest first. |
| `issuer` | required | The `iss` signed and required. |
| `audience` | required | The `aud` signed and required. |
| `typ` | `session+jwt` | The `typ` header signed and required. |
| `clockToleranceSeconds` | `5` | How far past `exp` a token still verifies. |

`joseConfig(env, { prefix? })` reads `AUTH_TOKEN_SECRETS` (comma separated), `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_AUDIENCE`, or the same names under `prefix`. It throws `AuthError.InvalidConfig` naming every missing or bad variable. The constructor runs the same checks. Secrets are never in the error.
