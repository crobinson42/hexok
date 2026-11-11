---
"@hexok/auth-jose": minor
---

New package. `JoseSessionToken` issues and reads `@hexok/auth` session tokens as HS256 JWTs that carry only the session id, `iss`, `aud`, `iat`, and `exp`, with a pinned `typ` and a `kid` that selects among rotated secrets. `joseConfig` reads the secrets, issuer, and audience from an env record, and `generateSecret` makes a secret.
