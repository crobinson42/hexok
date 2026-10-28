import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  LifecycleError,
  type LifecycleState,
  type LogSink,
  openRedis,
  RedisLifecycle,
  type StopContext,
} from '@hexok/ioredis-lifecycle';
import {
  ScheduleCoordinator,
  type ScheduleRegistration,
} from '@hexok/schedule-coordinator';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { CronPackageScheduler, type CronScheduler } from './cron-scheduler.js';

export interface RedisScheduleConfig {
  readonly redis: string | RedisOptions;
  /** Default `hexok:sched:`. */
  readonly keyPrefix?: string;
  /** Default 60, in seconds. A lock this process cannot release expires after this long. */
  readonly lockTtlSec?: number;
  /** Default 5000. `stop()` waits this long in all: for running ticks, then for the lock releases. A lock left behind expires after `lockTtlSec`. */
  readonly stopTimeoutMs?: number;
  /** Unset by default, so `start()` waits for Redis. Set, `start()` rejects with `StartTimeout` when Redis is not ready in time. */
  readonly startTimeoutMs?: number;
  readonly logger?: LogSink;
  readonly scheduler?: CronScheduler;
}

type Clients = { commands: Redis };
type Run = StopContext<Clients>['run'];

const ADAPTER = 'schedule';

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
  /** Random per acquisition, so a late renew or release from an earlier tick or session cannot touch a later lock. */
  readonly token: string;
  readonly controller: AbortController;
  renew: ReturnType<typeof setInterval> | undefined;
  /** Aborts the tick shortly before the lock can expire unrenewed. */
  expiry: ReturnType<typeof setTimeout> | undefined;
  warn: ReturnType<typeof setTimeout> | undefined;
  renewing: boolean;
  lost: boolean;
}

/** One running tick. Its identity keys `#ticks` and the async context. */
interface Running {
  readonly job: string;
}

export class RedisScheduleCoordinator extends Adapter(ScheduleCoordinator) {
  readonly #redis: string | RedisOptions;
  readonly #keyPrefix: string;
  readonly #lockTtlSec: number;
  readonly #stopTimeoutMs: number;
  readonly #logger: LogSink;
  readonly #scheduler: CronScheduler;
  readonly #lifecycle: RedisLifecycle<Clients>;
  readonly #jobs = new Map<string, { stop(): void | Promise<void> }>();
  /** Locks a tick holds or is acquiring. After waiting for ticks, `stop()` takes over the rest and releases them. */
  readonly #held = new Set<HeldLock>();
  readonly #ticks = new Map<Running, Promise<void>>();
  /** The tick the current code runs in, so `stop()` called from `onTick` does not wait for its own tick. */
  readonly #current = new AsyncLocalStorage<Running>();
  /** The stop context's `run` while `stop()` cleans up, so stopping ticks keep renewing and release their own locks. */
  #stopRun: Run | undefined;

  constructor(config: RedisScheduleConfig) {
    super();
    this.#redis = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:sched:';
    this.#lockTtlSec = config.lockTtlSec ?? 60;
    this.#stopTimeoutMs = config.stopTimeoutMs ?? 5000;
    this.#logger = config.logger ?? silent;
    this.#scheduler = config.scheduler ?? new CronPackageScheduler();
    this.#lifecycle = new RedisLifecycle({
      adapter: ADAPTER,
      stopTimeoutMs: this.#stopTimeoutMs,
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
    const caller = this.#current.getStore();
    // Ticks get the budget less a reserve for the release round trips, which run in parallel.
    const ticksDeadline =
      Date.now() +
      this.#stopTimeoutMs -
      Math.min(1000, this.#stopTimeoutMs / 4);
    return this.#lifecycle.stop(async ({ run }) => {
      this.#stopRun = run;
      try {
        const stopped: Array<void | Promise<void>> = [];
        for (const [name, handle] of this.#jobs) {
          const stopping = handle.stop();
          // The calling tick's job finishes only after this stop() returns, so its stop is not awaited.
          if (name === caller?.job) void Promise.resolve(stopping).catch(noop);
          else stopped.push(stopping);
        }
        this.#jobs.clear();
        for (const held of this.#held) {
          held.controller.abort();
          clearTimeout(held.warn);
        }
        // Locks stay held while ticks wind down, so no other process runs the job before they finish.
        const ticks = [...this.#ticks]
          .filter(([running]) => running !== caller)
          .map(([, tick]) => tick);
        // allSettled, so a custom scheduler's failed stop() does not end the wait early.
        await waitAtMost(
          Promise.allSettled([...ticks, ...stopped]),
          ticksDeadline - Date.now(),
        );
        const left = [...this.#held];
        this.#held.clear();
        for (const held of left) stopTimers(held);
        await Promise.all(left.map((held) => this.#release(held)));
      } finally {
        this.#stopRun = undefined;
      }
    });
  }

  #track(job: ScheduleRegistration): Promise<void> {
    const running: Running = { job: job.name };
    const tick = this.#current
      .run(running, () => this.#tick(job))
      .finally(() => this.#ticks.delete(running));
    this.#ticks.set(running, tick);
    return tick;
  }

  async #tick(job: ScheduleRegistration): Promise<void> {
    if (this.#lifecycle.state !== 'ready') return;
    const held: HeldLock = {
      job: job.name,
      key: `${this.#keyPrefix}lock:${job.name}`,
      token: randomUUID(),
      controller: new AbortController(),
      renew: undefined,
      expiry: undefined,
      warn: undefined,
      renewing: false,
      lost: false,
    };
    // Tracked before SET, so stop() releases a lock whose SET is in flight. The release follows the SET on the same connection.
    this.#held.add(held);
    const sentAt = Date.now();
    let acquired: string | null;
    try {
      acquired = await this.#command('acquire', ({ commands }) =>
        commands.set(held.key, held.token, 'EX', this.#lockTtlSec, 'NX'),
      );
    } catch (error) {
      this.#held.delete(held);
      this.#logCommandFailure(error, 'schedule: SET failed', job.name);
      return;
    }
    if (acquired !== 'OK') {
      this.#held.delete(held);
      this.#logger.debug('schedule: lock held', this.#fields(job.name));
      return;
    }
    try {
      // stop() began while SET was in flight. The lock is released without running onTick.
      if (this.#lifecycle.state !== 'ready') return;
      this.#extend(held, sentAt);
      held.renew = setInterval(
        () => {
          // #renew catches its own errors.
          void this.#renew(held);
        },
        Math.max(1, (this.#lockTtlSec * 1000) / 3),
      );
      if (job.warnAfterMs !== undefined && job.warnAfterMs > 0) {
        held.warn = setTimeout(() => {
          this.#logger.warn('schedule: job exceeded warnAfterMs', {
            ...this.#fields(job.name),
            warnAfterMs: job.warnAfterMs,
          });
        }, job.warnAfterMs);
      }
      await job.onTick({ signal: held.controller.signal });
    } catch (error) {
      this.#logger.error(
        asError(error, 'schedule: tick failed'),
        this.#fields(job.name),
      );
    } finally {
      stopTimers(held);
      if (this.#held.delete(held)) await this.#release(held);
    }
  }

  async #renew(held: HeldLock): Promise<void> {
    // One renew at a time. The expiry timer covers a renew that never answers.
    if (held.renewing) return;
    held.renewing = true;
    const sentAt = Date.now();
    try {
      const renewed = await this.#command('renew', ({ commands }) =>
        commands.eval(
          renewScript,
          1,
          held.key,
          held.token,
          String(this.#lockTtlSec),
        ),
      );
      if (held.lost) return;
      if (renewed === 0) {
        this.#lose(held);
        this.#logger.warn(
          'schedule: the lock was gone at renew, so the tick was aborted',
          this.#fields(held.job),
        );
      } else {
        this.#extend(held, sentAt);
      }
    } catch (error) {
      this.#lose(held);
      this.#logCommandFailure(error, 'schedule: renew failed', held.job);
    } finally {
      held.renewing = false;
    }
  }

  /**
   * The lock is valid until `sentAt` plus the TTL, timed from when the SET or renew was sent, because Redis may have run it at once.
   * The tick aborts a margin before that, so it stops before another process can take the lock, even with some timer lag.
   * Renews go out every third of the TTL, so a healthy renew lands well before the abort.
   */
  #extend(held: HeldLock, sentAt: number): void {
    const ttlMs = this.#lockTtlSec * 1000;
    const marginMs = Math.min(1000, ttlMs / 4);
    clearTimeout(held.expiry);
    held.expiry = setTimeout(
      () => {
        this.#lose(held);
        this.#logger.warn(
          'schedule: the lock was not renewed in time, so the tick was aborted',
          this.#redisFields(held.job),
        );
      },
      sentAt + ttlMs - marginMs - Date.now(),
    );
  }

  /** The lock is gone or unconfirmed. The tick is told to stop, and nothing renews the lock again. */
  #lose(held: HeldLock): void {
    held.lost = true;
    held.controller.abort();
    clearInterval(held.renew);
    clearTimeout(held.expiry);
    held.renew = undefined;
    held.expiry = undefined;
  }

  async #release(held: HeldLock): Promise<void> {
    try {
      await this.#command('release', ({ commands }) =>
        commands.eval(deleteScript, 1, held.key, held.token),
      );
    } catch (error) {
      this.#logCommandFailure(error, 'schedule: release failed', held.job);
    }
  }

  #command<T>(
    operation: string,
    command: (clients: Clients) => Promise<T>,
  ): Promise<T> {
    if (this.#stopRun !== undefined) return this.#stopRun(operation, command);
    return this.#lifecycle.run(operation, command);
  }

  /**
   * Logs a failed lock command. `StoppedBeforeReply` means stop() cut it short, which is a warning.
   * Other lifecycle errors mean the work came outside start() and stop(), and are not logged.
   */
  #logCommandFailure(error: unknown, fallback: string, job: string): void {
    if (LifecycleError.is(error)) {
      if (error.code === 'StoppedBeforeReply') {
        this.#logger.warn(error.message, this.#redisFields(job));
      }
      return;
    }
    this.#logger.error(asError(error, fallback), this.#redisFields(job));
  }

  /** For a job event or a failure in `onTick`. */
  #fields(job: string): Record<string, unknown> {
    return { adapter: ADAPTER, job };
  }

  /** For a failed Redis command. */
  #redisFields(job: string): Record<string, unknown> {
    return { adapter: ADAPTER, connection: 'commands', job };
  }
}

function stopTimers(held: HeldLock): void {
  clearInterval(held.renew);
  clearTimeout(held.expiry);
  clearTimeout(held.warn);
}

/** Resolves when `promise` resolves or after `ms`, whichever is first. It clears its timer. */
async function waitAtMost(
  promise: Promise<unknown>,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function asError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message);
}

function noop(): void {}
