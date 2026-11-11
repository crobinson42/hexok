# @hexok/auth

## 0.1.1

### Patch Changes

- [#29](https://github.com/crobinson42/hexok/pull/29) [`88f9c4a`](https://github.com/crobinson42/hexok/commit/88f9c4a2e39f755c687e1833f58f148abf690180) Thanks [@crobinson42](https://github.com/crobinson42)! - The README documents API keys and service accounts built on `Authenticator` and `resolving`.

## 0.1.0

### Minor Changes

- [#27](https://github.com/crobinson42/hexok/pull/27) [`1c81cd3`](https://github.com/crobinson42/hexok/commit/1c81cd3c5b4a9490c7746b9a7b6ead35decc8038) Thanks [@crobinson42](https://github.com/crobinson42)! - New package. `Authenticator<I>` turns an opaque credential into the identity it proves, or a refusal for logs: `missing`, `invalid`, `expired`, or `ended`. `resolving(authenticator, resolve)` is the seam where the app turns that identity into its own actor. `Sessions` runs login, logout, and authentication over a `SessionStore` and a `SessionToken`, with an idle window and an absolute end. `MemorySessionStore`, `OpaqueSessionToken`, `StaticTokenAuthenticator`, and `DevAuthenticator` ship in the package. `bearerToken` reads an `Authorization` header, and `sessionConfig` reads the two lifetimes from an env record the app passes.

### Patch Changes

- Updated dependencies [[`f7d659f`](https://github.com/crobinson42/hexok/commit/f7d659f76589371c827b972cb98c30cedac40653)]:
  - hexok@2.2.6
