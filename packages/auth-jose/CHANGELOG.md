# @hexok/auth-jose

## 0.1.0

### Minor Changes

- [#27](https://github.com/crobinson42/hexok/pull/27) [`656188d`](https://github.com/crobinson42/hexok/commit/656188d4eddb3888497b66e3ccbdd259035cc10c) Thanks [@crobinson42](https://github.com/crobinson42)! - New package. `JoseSessionToken` issues and reads `@hexok/auth` session tokens as HS256 JWTs that carry only the session id, `iss`, `aud`, `iat`, and `exp`, with a pinned `typ` and a `kid` that selects among rotated secrets. `joseConfig` reads the secrets, issuer, and audience from an env record, and `generateSecret` makes a secret.

### Patch Changes

- Updated dependencies [[`1c81cd3`](https://github.com/crobinson42/hexok/commit/1c81cd3c5b4a9490c7746b9a7b6ead35decc8038), [`f7d659f`](https://github.com/crobinson42/hexok/commit/f7d659f76589371c827b972cb98c30cedac40653)]:
  - @hexok/auth@0.1.0
  - hexok@2.2.6
