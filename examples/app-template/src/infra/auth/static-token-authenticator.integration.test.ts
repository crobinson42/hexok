import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRedis, type RedisClient } from '../clients/redis-client.js';
import { StaticTokenAuthenticator } from './static-token-authenticator.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

describe.skipIf(!process.env.REDIS_URL)(
  'StaticTokenAuthenticator integration',
  () => {
    let redis: RedisClient;

    beforeAll(async () => {
      redis = await connectRedis(process.env.REDIS_URL);
    });

    afterAll(async () => {
      await redis.close();
    });

    it('rejects a revoked token in every process', async () => {
      const token = randomUUID();
      const tokens = new Map([[token, 'ada']]);
      const other = await connectRedis(process.env.REDIS_URL);
      const first = new StaticTokenAuthenticator({ tokens, redis });
      const second = new StaticTokenAuthenticator({ tokens, redis: other });

      const caller = await first.authenticate(token);
      expect(caller?.userId).toBe('ada');
      expect(caller?.sessionId).toMatch(/^[0-9a-f]{32}$/);
      expect(caller?.sessionId).not.toContain(token);
      expect(await second.authenticate(token)).toEqual(caller);

      if (caller === null) throw new Error('expected a caller');
      await first.revoke(caller);

      expect(await second.authenticate(token)).toBeNull();
      await redis.del(`auth:revoked:${caller.sessionId}`);
      await other.close();
    });

    it('rejects a token it does not know', async () => {
      const auth = new StaticTokenAuthenticator({ tokens: new Map(), redis });

      expect(await auth.authenticate('nope')).toBeNull();
    });
  },
);
