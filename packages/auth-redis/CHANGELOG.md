# @hexok/auth-redis

## 0.1.0

### Minor Changes

- [#27](https://github.com/crobinson42/hexok/pull/27) [`00ac335`](https://github.com/crobinson42/hexok/commit/00ac335826023487f88ba51530ab5c4d7204c9c1) Thanks [@crobinson42](https://github.com/crobinson42)! - New package. `RedisSessionStore` keeps `@hexok/auth` sessions in Redis on `@hexok/ioredis-lifecycle`. Each session is one hash under a SHA-256 of its id, typed and checked by a Standard Schema of the identity. `resolve` enforces the absolute end and slides the idle TTL in one script. `sessionKey` gives a session's key for debugging.

### Patch Changes

- Updated dependencies [[`1c81cd3`](https://github.com/crobinson42/hexok/commit/1c81cd3c5b4a9490c7746b9a7b6ead35decc8038), [`f7d659f`](https://github.com/crobinson42/hexok/commit/f7d659f76589371c827b972cb98c30cedac40653)]:
  - @hexok/auth@0.1.0
  - hexok@2.2.6
