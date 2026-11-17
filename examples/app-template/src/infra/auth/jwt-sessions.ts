import type { AuthRefusal, SessionStore, SessionToken } from '@hexok/auth';
import { fail, type Result } from 'hexok';
import type { Caller } from '../../app/use-cases/context.js';

/**
 * What a gateway uses to turn a caller into a JWT and back.
 * The server injects one. A product can replace it.
 */
export type SessionJwt = {
  /** Caller to a new session id, then that id to a JWT. */
  toJwt(caller: Caller): Promise<string>;
  /** JWT to its session id, then that id to the caller. */
  fromJwt(jwt: string | undefined): Promise<Result<Caller, AuthRefusal>>;
  /** JWT to its session id, then delete that session. */
  revoke(jwt: string | undefined): Promise<void>;
};

/**
 * `store` keeps the caller under a session id. `token` signs and reads that
 * id. Neither step knows about the other.
 */
export class JwtSessions implements SessionJwt {
  constructor(
    private readonly deps: {
      readonly store: SessionStore<Caller>;
      readonly token: SessionToken;
    },
  ) {}

  async toJwt(caller: Caller): Promise<string> {
    const session = await this.deps.store.open(caller);
    return this.deps.token.issue(session.id, session.expiresAt);
  }

  async fromJwt(jwt: string | undefined): Promise<Result<Caller, AuthRefusal>> {
    if (jwt === undefined || jwt === '') return fail('missing');
    const id = await this.deps.token.read(jwt);
    if (!id.ok) return fail(id.code);
    return this.deps.store.resolve(id.value);
  }

  async revoke(jwt: string | undefined): Promise<void> {
    if (jwt === undefined || jwt === '') return;
    const id = await this.deps.token.read(jwt);
    if (!id.ok) return;
    await this.deps.store.close(id.value);
  }
}
