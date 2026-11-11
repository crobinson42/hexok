# @hexok/auth: design and plan

Written 2026-11-11 from research into infinity-billing's session auth and the company IdP. Built the same day.

## Why

Billing and `examples/app-template` each wrote an `Authenticator` port, and the two disagreed. Billing threw and returned its actor. app-template returned `Caller | null` and put `sessionId` on the caller so `revoke(caller)` could work. The company IdP only proves identity: a `Caller` of kind `user` or `service`, with no organizations or roles. Its example products map that `Caller` to their own actor in an app step.

The goal is a package that answers two questions, who does this credential prove and is it still valid, with one seam where the app turns that identity into its own actor. An app must be able to remove the package and plug in an identity provider by changing the composition root, login, and logout, never a use case.

## Decisions

- Add `@hexok/auth`, with adapters in `@hexok/auth-redis` and `@hexok/auth-jose`.
- The credential is an opaque `string | undefined`. The edge extracts it.
- Password hashing is out. When a second app needs it, it is a separate `@hexok/password` package, because hashing belongs to login and an app on API keys or an IdP never installs it.
- Redis adapters use ioredis on `@hexok/ioredis-lifecycle`, like the other Redis adapters.
- Neither hexok nor the IdP knows about the other. There is no IdP adapter. An app writes one in a few lines with the provider's SDK.

## Rules

1. The package proves an identity `I`. The app resolves it to an actor `A`. There is no universal identity shape: no organization, role, tenant, scope, `sub`, JWT, cookie, or `Request` in the core.
2. Each adapter chooses `I`. An adapter that stores it infers it from a Standard Schema. There is no global type override.
3. The seam is a plain function passed at construction, `resolving(auth, resolve)`.
4. Refusal codes are for logs. The app maps every refusal to one wire error. The package never picks an HTTP status.
5. Verification is the core. Issuing and ending sessions is a separate module that only the local-session path uses.
6. Only the composition root and the edge import `@hexok/auth`. Use cases see the app's actor. `Result` comes from `hexok`. The actor never carries a session id: logout acts on the credential at the edge.

A generic port works with the existing `Adapter(Port)<I>`, and `I` infers from `StandardSchemaV1.InferOutput<S>`. Hexok core did not change.

## Packages

| Package | Holds | Depends on |
| --- | --- | --- |
| `@hexok/auth` | `Authenticator`, `resolving`, `Sessions`, `SessionStore`, `SessionToken`, `MemorySessionStore`, `OpaqueSessionToken`, `StaticTokenAuthenticator`, `DevAuthenticator`, `bearerToken`, `sessionConfig`, `assertSessionConfig`, `AuthError`, `invalidConfig` | `hexok` |
| `@hexok/auth-redis` | `RedisSessionStore`, `sessionKey` | `@hexok/auth`, `@hexok/ioredis-lifecycle`, `ioredis` |
| `@hexok/auth-jose` | `JoseSessionToken`, `joseConfig`, `generateSecret` | `@hexok/auth`, peer `jose` |

Each package README is its docs page and states its behavior in full.

## What was built differently from the plan

- The Redis scripts run with `EVAL`, as the other Redis adapters do. The ACL user needs `+eval`, not `EVALSHA` or `SCRIPT LOAD`.
- A store reports both idle and absolute timeouts as `ended`, because a Redis key with a TTL simply disappears. A store reports `expired` only for a record that outlived its absolute end, which happens when the Redis clock and the app clock disagree. A signed token past its `exp` reads as `expired` before the store is asked.
- `invalidConfig` is exported, so an adapter outside hexok reports config problems the same way.
- In app-template, the RPC context is `{ api, signOut }`. Use cases receive `api`. `sessions.end` calls `signOut` at the edge.

## Not in scope

IdP, OIDC, and JWKS adapters. Login use cases. Cookie and BFF transport, and CSRF. Roles, permissions, and step-up. Refresh tokens. Ending every session of a user, which needs a per-user session index. Password hashing.

## Billing migration

This happens in billing's own repo, after the packages publish.

| Billing today | Package |
| --- | --- |
| `SessionStoreRedis` | `RedisSessionStore` with `identity` set to the `ApiActor` schema |
| `SessionTokenJose` | `JoseSessionToken` |
| `SessionAuthenticator` | `Sessions` |
| `DevActorAuthenticator` | `DevAuthenticator` |
| `bearerOf` | `bearerToken` |
| `runtime.sessions.close(authorization)` | `sessions.close(bearerToken(authorization))` |

`ApiActor` is the stored identity, so billing needs no resolver. Billing drops node-redis for ioredis, which `@hexok/queue-redis` also uses. The `LogIn` use case keeps its `Credentials` port and calls `sessions.open(actor)`.
