import { createHash, randomBytes } from 'node:crypto';
import {
  assertSessionConfig,
  type OpenedSession,
  type SessionConfig,
  SessionStore,
} from '@hexok/auth';
import {
  type LifecycleState,
  type LogSink,
  openRedis,
  RedisLifecycle,
} from '@hexok/ioredis-lifecycle';
import {
  Adapter,
  fail,
  type Infer,
  type Result,
  type StandardSchemaV1,
  validate,
  validationError,
} from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';

type Clients = { readonly commands: Redis };

const ADAPTER = 'auth-session';
const DEFAULT_KEY_PREFIX = 'hexok:session:';
const RECORD_VERSION = '1';

const silent: LogSink = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// KEYS[1] the session key. ARGV: identity JSON, created ms, absolute end ms, version, TTL ms.
const openScript = `
redis.call('HSET', KEYS[1], 'i', ARGV[1], 'c', ARGV[2], 'e', ARGV[3], 'v', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

// KEYS[1] the session key. ARGV: now ms (the app clock), idle ms.
// Returns {'live', identity JSON}, {'ended'}, {'expired'}, or {'corrupt'}. Expired and corrupt records are deleted.
const resolveScript = `
local fields = redis.pcall('HMGET', KEYS[1], 'i', 'e')
if type(fields) == 'table' and fields.err then
  redis.call('DEL', KEYS[1])
  return {'corrupt'}
end
local identity, raw = fields[1], fields[2]
if not identity and not raw then return {'ended'} end
local absoluteEnd = tonumber(raw)
if not identity or not absoluteEnd then
  redis.call('DEL', KEYS[1])
  return {'corrupt'}
end
local now, idle = tonumber(ARGV[1]), tonumber(ARGV[2])
if absoluteEnd <= now then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
redis.call('PEXPIRE', KEYS[1], math.min(idle, absoluteEnd - now))
return {'live', identity}
`;

export interface RedisSessionStoreConfig<S extends StandardSchemaV1>
  extends SessionConfig {
  /** A Redis URL or ioredis options. The store opens its own client. */
  readonly redis: string | RedisOptions;
  /**
   * The identity a session holds, as its JSON form. It types the store and
   * checks every identity on `open` and on every read.
   */
  readonly identity: S;
  /** Default `hexok:session:`. Every key is this prefix and a SHA-256 of the session id. */
  readonly keyPrefix?: string | undefined;
  readonly logger?: LogSink | undefined;
  /** Rejects `start()` when Redis is not ready in time. Unset, `start()` waits. */
  readonly startTimeoutMs?: number | undefined;
  /** The total time `stop()` may take. Default 5000. */
  readonly stopTimeoutMs?: number | undefined;
  /** Milliseconds since the epoch. Tests pass a fake clock. Default `Date.now`. */
  readonly now?: (() => number) | undefined;
}

/**
 * The Redis key of a session id, for debugging with `HGETALL`, `PTTL`, and
 * `DEL`. The key is a hash, so Redis never holds the id a token carries.
 */
export function sessionKey(id: string, keyPrefix = DEFAULT_KEY_PREFIX): string {
  return `${keyPrefix}${createHash('sha256').update(id).digest('base64url')}`;
}

/**
 * Sessions in Redis. One hash per session holds the identity JSON (`i`), the
 * open time (`c`), the absolute end (`e`), and the record version (`v`). The
 * key's TTL is the idle window, never past the absolute end. `resolve` checks
 * the absolute end and slides the TTL in one script, against the app clock.
 *
 * ```ts
 * const store = new RedisSessionStore({
 *   redis: process.env.REDIS_URL,
 *   identity: z.object({ organizationId: z.string(), userId: z.string() }),
 *   ...sessionConfig(process.env),
 * })
 * await store.start()
 * ```
 */
export class RedisSessionStore<S extends StandardSchemaV1> extends Adapter(
  SessionStore,
)<Infer<S>> {
  readonly #redis: string | RedisOptions;
  readonly #identity: S;
  readonly #keyPrefix: string;
  readonly #idleMs: number;
  readonly #absoluteMs: number;
  readonly #logger: LogSink;
  readonly #now: () => number;
  readonly #lifecycle: RedisLifecycle<Clients>;

  constructor(config: RedisSessionStoreConfig<S>) {
    super();
    assertSessionConfig(config);
    this.#redis = config.redis;
    this.#identity = config.identity;
    this.#keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.#idleMs = config.idleSeconds * 1000;
    this.#absoluteMs = config.absoluteSeconds * 1000;
    this.#logger = config.logger ?? silent;
    this.#now = config.now ?? Date.now;
    this.#lifecycle = new RedisLifecycle({
      adapter: ADAPTER,
      stopTimeoutMs: config.stopTimeoutMs ?? 5000,
      startTimeoutMs: config.startTimeoutMs,
      logger: config.logger,
    });
  }

  /** `ready` from `start()` until `stop()`, even while Redis is down. Use it to gate traffic, not as a Redis health check. */
  get state(): LifecycleState {
    return this.#lifecycle.state;
  }

  override start(): Promise<void> {
    return this.#lifecycle.start(() => ({ commands: openRedis(this.#redis) }));
  }

  override stop(): Promise<void> {
    return this.#lifecycle.stop();
  }

  override async open(identity: Infer<S>): Promise<OpenedSession> {
    const checked = validate(this.#identity, identity);
    if (!checked.ok) {
      throw validationError(
        'auth-session: the identity does not match its schema',
        checked.issues,
      );
    }
    const id = randomBytes(32).toString('base64url');
    const now = this.#now();
    const absoluteEnd = now + this.#absoluteMs;
    await this.#lifecycle.run('open', ({ commands }) =>
      commands.eval(
        openScript,
        1,
        sessionKey(id, this.#keyPrefix),
        JSON.stringify(identity),
        now,
        absoluteEnd,
        RECORD_VERSION,
        Math.min(this.#idleMs, this.#absoluteMs),
      ),
    );
    return { id, expiresAt: new Date(absoluteEnd) };
  }

  override async resolve(
    id: string,
  ): Promise<Result<Infer<S>, 'ended' | 'expired'>> {
    const key = sessionKey(id, this.#keyPrefix);
    const reply = await this.#lifecycle.run('resolve', ({ commands }) =>
      commands.eval(resolveScript, 1, key, this.#now(), this.#idleMs),
    );
    const [status, json] = Array.isArray(reply) ? reply : [];
    if (status === 'ended') return fail('ended');
    if (status === 'expired') return fail('expired');
    if (status === 'live' && typeof json === 'string') {
      const identity = this.#parse(json);
      if (identity.ok) return identity;
    }
    await this.#discard(key);
    return fail('ended');
  }

  override async close(id: string): Promise<void> {
    await this.#lifecycle.run('close', ({ commands }) =>
      commands.del(sessionKey(id, this.#keyPrefix)),
    );
  }

  #parse(json: string): Result<Infer<S>, 'VALIDATION'> {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      return fail('VALIDATION');
    }
    return validate(this.#identity, value);
  }

  // A record this store cannot read proves nothing. It is deleted and logged by its key, which is not a credential.
  async #discard(key: string): Promise<void> {
    await this.#lifecycle.run('resolve', ({ commands }) => commands.del(key));
    this.#logger.warn('auth-session: deleted an unreadable session record', {
      adapter: ADAPTER,
      key,
    });
  }
}
