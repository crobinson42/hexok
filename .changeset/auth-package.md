---
"@hexok/auth": minor
---

New package. `Authenticator<I>` turns an opaque credential into the identity it proves, or a refusal for logs: `missing`, `invalid`, `expired`, or `ended`. `resolving(authenticator, resolve)` is the seam where the app turns that identity into its own actor. `Sessions` runs login, logout, and authentication over a `SessionStore` and a `SessionToken`, with an idle window and an absolute end. `MemorySessionStore`, `OpaqueSessionToken`, `StaticTokenAuthenticator`, and `DevAuthenticator` ship in the package. `bearerToken` reads an `Authorization` header, and `sessionConfig` reads the two lifetimes from an env record the app passes.
