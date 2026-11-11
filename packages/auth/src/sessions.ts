import { Adapter, fail, Port, type Result } from 'hexok';
import { Authenticator, type AuthRefusal } from './authenticator.js';

/** A session a store just opened. `expiresAt` is its absolute end. */
export type OpenedSession = {
  readonly id: string;
  readonly expiresAt: Date;
};

/**
 * Server-side sessions. The store is the authority: a token that names a
 * session the store does not have proves nothing.
 *
 * A store keeps two clocks. The idle window slides on every `resolve`. The
 * absolute end never moves. A session ends at whichever comes first.
 */
export abstract class SessionStore<I> extends Port('SessionStore') {
  /** Opens a session for `identity` under a new random id. It never reuses an id. */
  abstract open(identity: I): Promise<OpenedSession>;

  /**
   * The identity of a live session, and slides its idle window, never past
   * the absolute end. `ended` when no live session has the id. `expired` when
   * the record outlived its absolute end, which the store then deletes.
   */
  abstract resolve(id: string): Promise<Result<I, 'ended' | 'expired'>>;

  /** Deletes the session. A missing one is already closed. */
  abstract close(id: string): Promise<void>;
}

/**
 * Translates a session id to and from the string the client holds.
 * It knows nothing about the identity or the store.
 */
export abstract class SessionToken extends Port('SessionToken') {
  /** The token for `id`. `expiresAt` is the session's absolute end. */
  abstract issue(id: string, expiresAt: Date): Promise<string>;

  /** The session id `token` names, or why the token is not accepted. */
  abstract read(token: string): Promise<Result<string, 'invalid' | 'expired'>>;
}

/**
 * Login, logout, and authentication over a store and a token.
 * It is an `Authenticator` of the stored identity.
 *
 * The identity comes from the store, never from the token. Logout acts on the
 * credential, so the identity never carries a session id. Start and stop the
 * store you construct. `Sessions` does not own it.
 *
 * ```ts
 * const sessions = new Sessions({ store, token })
 * const token = await sessions.open({ userId })          // login
 * const found = await sessions.authenticate(credential)  // each call
 * await sessions.close(credential)                        // logout
 * ```
 */
export class Sessions<I> extends Adapter(Authenticator)<I> {
  readonly #store: SessionStore<I>;
  readonly #token: SessionToken;

  constructor(deps: {
    readonly store: SessionStore<I>;
    readonly token: SessionToken;
  }) {
    super();
    this.#store = deps.store;
    this.#token = deps.token;
  }

  /** Opens a session for `identity` and returns the token the client holds. */
  async open(identity: I): Promise<string> {
    const session = await this.#store.open(identity);
    return this.#token.issue(session.id, session.expiresAt);
  }

  /** Ends the session the credential names. A missing or bad credential is already signed out. */
  async close(credential: string | undefined): Promise<void> {
    if (credential === undefined || credential === '') return;
    const id = await this.#token.read(credential);
    if (!id.ok) return;
    await this.#store.close(id.value);
  }

  override async authenticate(
    credential: string | undefined,
  ): Promise<Result<I, AuthRefusal>> {
    if (credential === undefined || credential === '') return fail('missing');
    const id = await this.#token.read(credential);
    if (!id.ok) return fail(id.code);
    return this.#store.resolve(id.value);
  }
}
