import { Adapter, fail, ok, type Result } from 'hexok';
import { Authenticator, type AuthRefusal } from './authenticator.js';

/**
 * Answers every call as one configured identity and ignores the credential.
 * With no identity it refuses every call, so a deploy that forgets to
 * configure it is closed, not open. Select it by explicit config for local
 * development. Never make it the default.
 *
 * ```ts
 * const auth = env.AUTH_MODE === 'dev'
 *   ? new DevAuthenticator({ identity: devActor })
 *   : sessions
 * ```
 */
export class DevAuthenticator<I> extends Adapter(Authenticator)<I> {
  readonly #identity: I | undefined;

  constructor(config: { readonly identity: I | undefined }) {
    super();
    this.#identity = config.identity;
  }

  override async authenticate(
    _credential: string | undefined,
  ): Promise<Result<I, AuthRefusal>> {
    return this.#identity === undefined ? fail('invalid') : ok(this.#identity);
  }
}
