import { Adapter, fail, ok, type Result } from 'hexok';
import { SessionToken } from './sessions.js';

// A session id is 43 characters. Anything far longer is not one, and is refused before it reaches a store.
const MAX_LENGTH = 512;

/**
 * The token is the session id itself. The store decides everything, so a
 * token is only as good as the store's lookup. Use it in tests, and in one
 * service where the token never leaves that service. A signed token adds a
 * check before the store and binds the token to an issuer and audience.
 */
export class OpaqueSessionToken extends Adapter(SessionToken) {
  override async issue(id: string, _expiresAt: Date): Promise<string> {
    return id;
  }

  override async read(
    token: string,
  ): Promise<Result<string, 'invalid' | 'expired'>> {
    if (token === '' || token.length > MAX_LENGTH) return fail('invalid');
    return ok(token);
  }
}
