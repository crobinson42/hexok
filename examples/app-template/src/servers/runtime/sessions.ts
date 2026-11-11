import { type Env, Sessions, sessionConfig } from '@hexok/auth';
import { JoseSessionToken, joseConfig } from '@hexok/auth-jose';
import { RedisSessionStore } from '@hexok/auth-redis';
import type { Logger } from '@hexok/logger';
import { type Caller, callerSchema } from '../../app/use-cases/context.js';

/**
 * Sessions in Redis behind signed tokens. Only HTTP and the session script
 * build them. Start `store` before the first call and stop it on shutdown.
 *
 * `AUTH_TOKEN_SECRETS`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_AUDIENCE` are
 * required. `AUTH_SESSION_IDLE_SECONDS` and `AUTH_SESSION_ABSOLUTE_SECONDS`
 * default to 30 minutes and 8 hours.
 */
export function createSessions(options: {
  env: Env;
  redisUrl: string;
  logger: Logger;
}): {
  sessions: Sessions<Caller>;
  store: RedisSessionStore<typeof callerSchema>;
} {
  const store = new RedisSessionStore({
    redis: options.redisUrl,
    identity: callerSchema,
    keyPrefix: 'app-template:session:',
    logger: options.logger,
    ...sessionConfig(options.env),
  });
  const token = new JoseSessionToken(joseConfig(options.env));
  return { sessions: new Sessions({ store, token }), store };
}
