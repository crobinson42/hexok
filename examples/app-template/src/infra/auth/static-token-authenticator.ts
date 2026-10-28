import { createHash } from 'node:crypto';
import { Adapter } from 'hexok';
import {
  Authenticator,
  type Caller,
} from '../../app/ports/auth/authenticator.js';
import type { RedisClient } from '../clients/redis-client.js';

/**
 * Tokens from config, each mapped to a user id. It fits service tokens and
 * local development. A JWT or session adapter replaces it for real users.
 *
 * Each token is one session, and the session id is a hash of the token.
 * Static tokens do not expire. A revoked token is listed in Redis, so every
 * process rejects it, until `auth:revoked:<sessionId>` is deleted.
 */
export class StaticTokenAuthenticator extends Adapter(Authenticator) {
  constructor(
    private readonly deps: {
      tokens: ReadonlyMap<string, string>;
      redis: RedisClient;
    },
  ) {
    super();
  }

  override async authenticate(token: string): Promise<Caller | null> {
    const userId = this.deps.tokens.get(token);
    if (userId === undefined) return null;
    const sessionId = sessionIdOf(token);
    if ((await this.deps.redis.exists(revokedKey(sessionId))) > 0) return null;
    return { userId, sessionId };
  }

  override async revoke(caller: Caller): Promise<void> {
    await this.deps.redis.set(revokedKey(caller.sessionId), '1');
  }
}

/** Not the token itself, so logs and Redis never hold it. */
function sessionIdOf(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function revokedKey(sessionId: string): string {
  return `auth:revoked:${sessionId}`;
}
