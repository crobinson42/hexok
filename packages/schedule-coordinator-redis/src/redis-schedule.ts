import { randomUUID } from 'node:crypto';
import {
  type LifecycleState,
  type LogSink,
  openRedis,
  RedisLifecycle,
  type StopContext,
} from '@hexok/ioredis-lifecycle';
import {
  ScheduleCoordinator,
  type ScheduleRegistration,
  type ScheduleTick,
} from '@hexok/schedule-coordinator';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { CronPackageScheduler, type CronScheduler } from './cron-scheduler.js';

export interface RedisScheduleConfig {
  readonly redis: string | RedisOptions;
  /** Default `hexok:sched:`. */
  readonly keyPrefix?: string;
  /** Default 60. A lock this process cannot release expires after this many seconds. */
  readonly lockTtlSec?: number;
  /** Default 5000. Releasing locks takes a few round trips, and a lock left behind expires after `lockTtlSec`. */
  readonly stopTimeoutMs?: number;
  /** Unset by default, so `start()` waits for Redis. */
  readonly startTimeoutMs?: number;
  readonly logger?: LogSink;
  readonly scheduler?: CronScheduler;
}

type Clients = { commands: Redis };
type Run = StopContext<Clients>['run'];

const renewScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

const deleteScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

const silent: LogSink = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

interface HeldLock {
  readonly job: string;
  readonly key: string;
  readonly controller: AbortController;
  renew: ReturnType<typeof setInterval> | undefined;
  renewing: boolean;
  warn: ReturnType<typeof setTimeout> | undefined;
}

export class RedisScheduleCoordinator extends Adapter(ScheduleCoordinator) {
  readonly #redis: string | RedisOptions;
  readonly #keyPrefix: string;
  readonly #lockTtlSec: number;
  readonly #logger: LogSink;
  readonly #scheduler: CronScheduler;
  readonly #lifecycle: RedisLifecycle<Clients>;
  readonly #ownerId = randomUUID();
  readonly #jobs = new Map<string, { stop(): void | Promise<void> }>();
  /** Locks a tick holds or is acquiring. `stop()` takes them over and releases them. */
  readonly #held = new Set<HeldLock>();
  readonly #ticks = new Set<Promise<void>>();

  constructor(config: RedisScheduleConfig) {
    super();
    this.#redis = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:sched:';
    this.#lockTtlSec = config.lockTtlSec ?? 60;
    this.#logger = config.logger ?? silent;
    this.#scheduler = config.scheduler ?? new CronPackageScheduler();
    this.#lifecycle = new RedisLifecycle({
      adapter: 'schedule',
      stopTimeoutMs: config.stopTimeoutMs ?? 5000,
      startTimeoutMs: config.startTimeoutMs,
      logger: config.logger,
    });
  }

  /** The lifecycle state. It suits a readiness or health check. */
  get state(): LifecycleState {
    return this.#lifecycle.state;
  }

  override start(): Promise<void> {
    return this.#lifecycle.start(() => ({ commands: openRedis(this.#redis) }));
  }

  register(job: ScheduleRegistration): void {
    this.#lifecycle.assertReady('register');
    if (this.#jobs.has(job.name)) {
      throw new Error(`schedule: job "${job.name}" is already registered`);
    }
    const handle = this.#scheduler.schedule({
      cron: job.cron,
      ...(job.timezone !== undefined ? { timezone: job.timezone } : {}),
      runOnInit: job.runOnRegister ?? false,
      onTick: () => this.#track(job),
    });
    this.#jobs.set(job.name, handle);
  }

  override stop(): Promise<void> {
    return this.#lifecycle.stop(async ({ run }) => {
      const stopped = [...this.#jobs.values()].map((handle) => handle.stop());
      this.#jobs.clear();
      const held = [...this.#held];
      this.#held.clear();
      for (const lock of held) {
        lock.controller.abort();
        clearInterval(lock.renew);
        clearTimeout(lock.warn);
      }
      // Locks are released at once, not after the ticks, so a tick that ignores its signal cannot keep them past stop().
      await Promise.all([
        ...held.map((lock) => this.#release(lock, run)),
        ...stopped,
        ...this.#ticks,
      ]);
    });
  }

  #track(job: ScheduleRegistration): Promise<void> {
    const tick = this.#tick(job).finally(() => this.#ticks.delete(tick));
    this.#ticks.add(tick);
    return tick;
  }

  async #tick(job: ScheduleRegistration): Promise<void> {
    const held: HeldLock = {
      job: job.name,
      key: `${this.#keyPrefix}lock:${job.name}`,
      controller: new AbortController(),
      renew: undefined,
      renewing: false,
      warn: undefined,
    };
    // Tracked before SET, so stop() releases a lock whose SET is in flight. Its release follows the SET on the same connection.
    this.#held.add(held);
    let acquired: string | null;
    try {
      acquired = await this.#lifecycle.run('acquire', ({ commands }) =>
        commands.set(held.key, this.#ownerId, 'EX', this.#lockTtlSec, 'NX'),
      );
    } catch (error) {
      this.#held.delete(held);
      this.#logger.error(
        asError(error, 'schedule: SET failed'),
        this.#fields(job.name),
      );
      return;
    }
    // stop() began while SET was in flight, and it releases this lock.
    if (!this.#held.has(held)) return;
    if (acquired !== 'OK') {
      this.#held.delete(held);
      this.#logger.debug('schedule: lock held', this.#fields(job.name));
      return;
    }
    const renewMs = Math.max(1, (this.#lockTtlSec / 2) * 1000);
    held.renew = setInterval(() => {
      // #renew catches its own errors.
      void this.#renew(held);
    }, renewMs);
    if (job.warnAfterMs !== undefined && job.warnAfterMs > 0) {
      held.warn = setTimeout(() => {
        this.#logger.warn('schedule: job exceeded warnAfterMs', {
          ...this.#fields(job.name),
          warnAfterMs: job.warnAfterMs,
        });
      }, job.warnAfterMs);
    }
    const tick: ScheduleTick = { signal: held.controller.signal };
    try {
      await job.onTick(tick);
    } catch (error) {
      this.#logger.error(
        asError(error, 'schedule: tick failed'),
        this.#fields(job.name),
      );
    } finally {
      clearInterval(held.renew);
      clearTimeout(held.warn);
      // Once stop() begins, it owns the release, so this tick sends nothing more to Redis.
      if (this.#held.delete(held)) {
        await this.#release(held, (operation, command) =>
          this.#lifecycle.run(operation, command),
        );
      }
    }
  }

  async #renew(held: HeldLock): Promise<void> {
    if (held.renewing) {
      // The last renew has not answered for half the TTL, so the lock may have expired and another process may hold it.
      this.#lose(held);
      this.#logger.warn(
        'schedule: lock renew did not answer in time, so the tick was aborted',
        this.#fields(held.job),
      );
      return;
    }
    held.renewing = true;
    try {
      const renewed = await this.#lifecycle.run('renew', ({ commands }) =>
        commands.eval(
          renewScript,
          1,
          held.key,
          this.#ownerId,
          String(this.#lockTtlSec),
        ),
      );
      if (renewed === 0) this.#lose(held);
    } catch (error) {
      this.#lose(held);
      this.#logger.error(
        asError(error, 'schedule: renew failed'),
        this.#fields(held.job),
      );
    } finally {
      held.renewing = false;
    }
  }

  /** The lock is gone or unconfirmed. The tick is told to stop, and nothing renews the lock again. */
  #lose(held: HeldLock): void {
    held.controller.abort();
    clearInterval(held.renew);
    held.renew = undefined;
  }

  async #release(held: HeldLock, run: Run): Promise<void> {
    try {
      await run('release', ({ commands }) =>
        commands.eval(deleteScript, 1, held.key, this.#ownerId),
      );
    } catch (error) {
      this.#logger.error(
        asError(error, 'schedule: release failed'),
        this.#fields(held.job),
      );
    }
  }

  #fields(job: string): Record<string, unknown> {
    return { adapter: 'schedule', connection: 'commands', job };
  }
}

function asError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message);
}
