import { StaticTokenAuthenticator } from '../../infra/auth/static-token-authenticator.js';
import type { RedisClient } from '../../infra/clients/redis-client.js';

/**
 * `AUTH_TOKENS` is `userId=token` pairs, comma separated. Unset means no
 * token checks out, so every caller is anonymous. Revoked tokens are listed
 * in Redis.
 */
export function createAuthenticator(
  redis: RedisClient,
): StaticTokenAuthenticator {
  const tokens = new Map<string, string>();
  for (const pair of (process.env.AUTH_TOKENS ?? '').split(',')) {
    const at = pair.indexOf('=');
    const userId = pair.slice(0, at).trim();
    const token = pair.slice(at + 1).trim();
    if (at > 0 && userId !== '' && token !== '') tokens.set(token, userId);
  }
  return new StaticTokenAuthenticator({ tokens, redis });
}
