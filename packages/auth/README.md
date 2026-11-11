# @hexok/auth

Credential verification for hexok. Install with `npm i @hexok/auth`. It answers two questions: who does this credential prove, and is it still valid. The app answers the third, who that is to the app, in one function it owns.

The package proves an **identity**. The app resolves it to an **actor**. They are two types. The package defines neither. It has no user, organization, role, tenant, scope, `sub`, JWT, cookie, or `Request`.

## Quick start

```ts
import { OpaqueSessionToken, Sessions, bearerToken, sessionConfig } from '@hexok/auth';
import { RedisSessionStore } from '@hexok/auth-redis';
import { z } from 'zod';

const actor = z.object({ organizationId: z.string(), userId: z.string() });

const store = new RedisSessionStore({ redis: env.REDIS_URL, identity: actor, ...sessionConfig(env) });
await store.start();
const sessions = new Sessions({ store, token: new OpaqueSessionToken() });

// login, after the app checked the credentials it owns
const token = await sessions.open({ organizationId, userId });

// every call, at the edge
const found = await sessions.authenticate(bearerToken(request.headers.get('authorization')));
if (!found.ok) return unauthorized(); // log found.code, never send it
await useCase.execute({ actor: found.value }, input);

// logout, at the edge
await sessions.close(bearerToken(request.headers.get('authorization')));
```

## Rules

- Only the composition root and the edge import `@hexok/auth`. Use cases receive the app's actor on their context and never import this package. Then the package can be removed: a swap to an identity provider changes the composition root, login, and logout, and no use case.
- The actor never carries a session id or a token. Logout acts on the credential at the edge.
- A refusal is for logs. Map every refusal to one wire error, so a caller cannot tell a deleted session from a bad token. The package never picks an HTTP status.
- Authorization is not here. Roles, permissions, membership, and step-up are checks on the actor, in use-case guards.
- `Result`, `ok`, and `fail` come from `hexok`, not from this package.

## Authenticator

```ts
abstract class Authenticator<I, E extends string = AuthRefusal> {
  authenticate(credential: string | undefined): Promise<Result<I, E>>;
}
```

The credential is an opaque string the edge extracted, such as a Bearer token or a cookie value. `undefined` is no credential. A refusal is a `fail` result. A throw is an infrastructure failure, such as a store that does not answer. Let it reach the app's error handling as a server error, not a 401.

| `AuthRefusal` | Meaning |
| --- | --- |
| `missing` | No credential. |
| `invalid` | Malformed, a bad signature, or a token this process does not accept. |
| `expired` | The token, or the session record, passed its absolute end. |
| `ended` | The token checks out and its session is gone: logged out, idle, or deleted. |

## Resolving the actor

`resolving` is the seam. It takes an authenticator of identity `I` and the app's function from `I` to its actor `A`, and returns an authenticator of `A`.

```ts
import { resolving } from '@hexok/auth';
import { fail, ok } from 'hexok';

const auth = resolving(provider, async (identity) => {
  const user = await users.bySubject(identity.subject);
  if (user === undefined) return fail('unknown');
  return ok({ organizationId: user.organizationId, userId: user.id });
});
// Authenticator<Actor, AuthRefusal | 'unknown'>
```

- A refusal from the authenticator skips the resolver.
- The resolver names its own refusals, such as `unknown` for a subject with no account or `forbidden` for a service token on a user route.
- A resolver throw passes through as a throw.
- When the identity already is the actor, as when a session stores the actor, there is no resolver.

## Sessions

Server-side sessions, for an app that signs its own users in. The store is the authority. A token that names a session the store does not have proves nothing, so logout and expiry are a delete.

```ts
abstract class SessionStore<I> {
  open(identity: I): Promise<{ id: string; expiresAt: Date }>;
  resolve(id: string): Promise<Result<I, 'ended' | 'expired'>>;
  close(id: string): Promise<void>;
}
abstract class SessionToken {
  issue(id: string, expiresAt: Date): Promise<string>;
  read(token: string): Promise<Result<string, 'invalid' | 'expired'>>;
}
```

`Sessions` puts a store and a token together. It is an `Authenticator` of the stored identity.

| Method | Does |
| --- | --- |
| `open(identity)` | Opens a session under a new random id and returns the token. Login calls it after the app checked the credentials. |
| `authenticate(credential)` | Reads the token, then resolves the session in the store. The identity comes from the store, never from the token. |
| `close(credential)` | Deletes the session the credential names. A missing or bad credential is already signed out. |

A store keeps two clocks. The idle window slides on every `resolve`. The absolute end never moves. A session ends at whichever comes first. A session id is never reused, and `open` always makes a new one. The store owns the absolute end and hands it to the token as `expiresAt`, so the lifetime is configured once.

Start and stop the store you construct. `Sessions` does not own it.

| Adapter | Package | Use |
| --- | --- | --- |
| `RedisSessionStore` | `@hexok/auth-redis` | Shared sessions across processes. |
| `MemorySessionStore` | this package | Tests and single-process development. A restart ends every session. |
| `JoseSessionToken` | `@hexok/auth-jose` | A signed JWT that names the session. Checked before the store and bound to an issuer and audience. |
| `OpaqueSessionToken` | this package | The token is the session id. Tests, and one service where the token never leaves it. |

`MemorySessionStore` takes `{ idleSeconds, absoluteSeconds, now? }`. A record vanishes at the earlier of its two ends, the way a Redis key with a TTL does.

## Static and dev authenticators

`StaticTokenAuthenticator` maps fixed tokens to identities. It fits service tokens and local development. It keeps a SHA-256 of each token, not the token. A blank token in config throws. A static token cannot be revoked except by restarting without it.

```ts
new StaticTokenAuthenticator({ tokens: [[env.REPORTS_TOKEN, { service: 'reports' }]] });
```

`DevAuthenticator` answers every call as one configured identity and ignores the credential. With `identity: undefined` it refuses every call, so a deploy that forgets it is closed, not open. Select it by explicit config. Never make it the default.

```ts
const auth = env.AUTH_MODE === 'dev' ? new DevAuthenticator({ identity: devActor }) : sessions;
```

## API keys and service accounts

The package has no API key store. A key is a credential, so an app builds API keys and service accounts on `Authenticator` and `resolving`.

A few fixed service tokens fit `StaticTokenAuthenticator`. Keys that callers create and revoke at runtime need an authenticator the app writes against its own key store.

```ts
import { createHash } from 'node:crypto';
import { Authenticator, type AuthRefusal } from '@hexok/auth';
import { Adapter, fail, ok, type Result } from 'hexok';

class ApiKeyAuthenticator extends Adapter(Authenticator)<ApiKeyIdentity> {
  readonly #keys: ApiKeyRepository;

  constructor(keys: ApiKeyRepository) {
    super();
    this.#keys = keys;
  }

  override async authenticate(
    credential: string | undefined,
  ): Promise<Result<ApiKeyIdentity, AuthRefusal>> {
    if (credential === undefined || credential === '') return fail('missing');
    const hash = createHash('sha256').update(credential).digest('base64url');
    const key = await this.#keys.byHash(hash);
    if (key === undefined) return fail('invalid');
    if (key.revokedAt !== undefined) return fail('ended');
    if (key.expiresAt !== undefined && key.expiresAt <= new Date()) return fail('expired');
    return ok({ keyId: key.id, accountId: key.accountId, scopes: key.scopes });
  }
}

const apiKeys = resolving(new ApiKeyAuthenticator(keyRepository), async (identity) =>
  ok({ kind: 'service' as const, accountId: identity.accountId, scopes: identity.scopes }),
);
```

- Store a hash of each key, never the key. Show the key once, when it is created. A random key of 32 bytes or more makes a plain SHA-256 enough. A slow password hash is not needed.
- Look the key up by its hash. Do not compare key strings.
- A revoked key is `ended`. A key past its end is `expired`. An unknown key is `invalid`.
- Do not use `Sessions` for API keys. A session has an idle window and an absolute end. A key that lives for months fits neither.
- Scopes and permissions are checks on the actor, in use-case guards, the same as roles.

When one route accepts both user sessions and API keys, the edge picks the authenticator. A fixed key prefix, such as `sk_`, makes the choice without a lookup. Give the actor a `kind`, so a guard can tell a service from a user.

```ts
const authenticate = (credential: string | undefined) =>
  credential?.startsWith('sk_') ? apiKeys.authenticate(credential) : users.authenticate(credential);
```

A route that serves only users refuses a service actor in its resolver, such as with `fail('forbidden')`, or in a use-case guard.

## Helpers

`bearerToken(header)` returns the token of an `Authorization: Bearer <token>` header. It returns `undefined` for no header, another scheme, or anything after the token. The scheme is case-insensitive, as RFC 6750 says.

`sessionConfig(env, { prefix? })` reads `AUTH_SESSION_IDLE_SECONDS` (default 1800) and `AUTH_SESSION_ABSOLUTE_SECONDS` (default 28800), or the same names under `prefix`. It takes the environment the app passes. The package never reads `process.env`. A blank value is unset. Idle longer than absolute is refused.

Every config check throws `AuthError.InvalidConfig` once, with every problem in `error.data.problems` and in the message. Secrets are never in either. `assertSessionConfig(config)` runs the same checks on values a store adapter received in code. `invalidConfig(problems)` builds the error for an adapter of your own.

`AuthError.Unauthenticated` is one error for an edge that throws on every refusal.

## Swapping the provider

To move to an identity provider, write an `Authenticator` of that provider's identity in the app. It verifies the provider's token with the provider's SDK, then `resolving` turns that identity into the same actor.

```ts
class ProviderAuthenticator extends Adapter(Authenticator)<ProviderIdentity> {
  override async authenticate(credential: string | undefined) {
    if (credential === undefined) return fail('missing');
    try {
      return ok(await provider.verify(credential));
    } catch {
      return fail('invalid');
    }
  }
}

const auth = resolving(new ProviderAuthenticator(), toActor);
```

Login, logout, and the session store go away, because the provider runs them. The edge may change transport, such as from a Bearer header to a cookie. Use cases keep the same actor. To remove this package entirely, the app declares its own port with the same `authenticate` shape. Nothing outside the edge changes.

## Left to the app

- Where credentials are stored and how passwords are checked.
- Issuing, storing, rotating, and revoking API keys.
- The login and logout procedures, and rate limits on login.
- The transport: header, cookie, or message field. A cookie needs a CSRF defense.
- Mapping refusals to the wire, and logging them.
- Authorization.
