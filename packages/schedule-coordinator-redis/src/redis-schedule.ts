import { randomUUID } from 'node:crypto';
import {
  ScheduleCoordinator,
  type ScheduleRegistration,
  type ScheduleTick,
} from '@hexok/schedule-coordinator';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { openRedis } from './codec.js';
import { CronPackageScheduler, type CronScheduler } from './cron-scheduler.js';
import { type LogSink, noopSink } from './log-sink.js';

export interface RedisScheduleConfig {
  readonly redis: string | RedisOptions;
  readonly keyPrefix?: string;
  readonly lockTtlSec?: number;
  readonly logger?: LogSink;
  readonly scheduler?: CronScheduler;
}

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

interface HeldLock {
  key: string;
  controller: AbortController;
  renew: ReturnType<typeof setInterval> | undefined;
  warn: ReturnType<typeof setTimeout> | undefined;
}

export class RedisScheduleCoordinator extends Adapter(ScheduleCoordinator) {
  readonly #redisOptions: string | RedisOptions;
  readonly #keyPrefix: string;
  readonly #lockTtlSec: number;
  readonly #logger: LogSink;
  readonly #scheduler: CronScheduler;
  readonly #ownerId = randomUUID();
  readonly #names = new Set<string>();
  readonly #stops: Array<() => void> = [];
  readonly #held = new Map<string, HeldLock>();
  #redis: Redis | undefined;

  constructor(config: RedisScheduleConfig) {
    super();
    this.#redisOptions = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:sched:';
    this.#lockTtlSec = config.lockTtlSec ?? 60;
    this.#logger = config.logger ?? noopSink;
    this.#scheduler = config.scheduler ?? new CronPackageScheduler();
  }

  async start(): Promise<void> {
    if (this.#redis) return;
    this.#redis = openRedis(this.#redisOptions);
  }

  register(job: ScheduleRegistration): void {
    if (!this.#redis) throw new Error('schedule: start() was not called');
    if (this.#names.has(job.name)) {
      throw new Error(`schedule: job "${job.name}" is already registered`);
    }
    this.#names.add(job.name);
    const handle = this.#scheduler.schedule({
      cron: job.cron,
      ...(job.timezone !== undefined ? { timezone: job.timezone } : {}),
      runOnInit: job.runOnRegister ?? false,
      onTick: () => this.#tick(job),
    });
    this.#stops.push(() => handle.stop());
  }

  override async stop(): Promise<void> {
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    for (const held of this.#held.values()) {
      held.controller.abort();
      if (held.renew) clearInterval(held.renew);
      if (held.warn) clearTimeout(held.warn);
    }
    for (const [name, held] of this.#held) {
      try {
        await this.#compareDelete(held.key);
      } catch (error) {
        this.#logger.error(
          error instanceof Error
            ? error
            : new Error('schedule: release failed'),
          { name },
        );
      }
    }
    this.#held.clear();
    const redis = this.#redis;
    this.#redis = undefined;
    if (redis) {
      await redis.quit().catch((error: unknown) => {
        this.#logger.error(
          error instanceof Error ? error : new Error('schedule: quit failed'),
        );
      });
    }
  }

  async #tick(job: ScheduleRegistration): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    const key = `${this.#keyPrefix}lock:${job.name}`;
    let acquired: string | null;
    try {
      acquired = await redis.set(
        key,
        this.#ownerId,
        'EX',
        this.#lockTtlSec,
        'NX',
      );
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('schedule: SET failed'),
        { name: job.name },
      );
      return;
    }
    if (acquired !== 'OK') {
      this.#logger.debug('schedule: lock held', { name: job.name });
      return;
    }
    const controller = new AbortController();
    const held: HeldLock = {
      key,
      controller,
      renew: undefined,
      warn: undefined,
    };
    this.#held.set(job.name, held);
    const renewMs = Math.max(1, (this.#lockTtlSec / 2) * 1000);
    held.renew = setInterval(() => {
      void this.#renew(job.name, held);
    }, renewMs);
    if (job.warnAfterMs !== undefined && job.warnAfterMs > 0) {
      held.warn = setTimeout(() => {
        this.#logger.warn('schedule: job exceeded warnAfterMs', {
          name: job.name,
          warnAfterMs: job.warnAfterMs,
        });
      }, job.warnAfterMs);
    }
    const tick: ScheduleTick = { signal: controller.signal };
    try {
      await job.onTick(tick);
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('schedule: tick failed'),
        { name: job.name },
      );
    } finally {
      if (held.renew) clearInterval(held.renew);
      if (held.warn) clearTimeout(held.warn);
      try {
        await this.#compareDelete(key);
      } catch (error) {
        this.#logger.error(
          error instanceof Error
            ? error
            : new Error('schedule: release failed'),
          { name: job.name },
        );
      }
      this.#held.delete(job.name);
    }
  }

  async #renew(name: string, held: HeldLock): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    try {
      const renewed = await redis.eval(
        renewScript,
        1,
        held.key,
        this.#ownerId,
        String(this.#lockTtlSec),
      );
      if (renewed === 0) {
        held.controller.abort();
        if (held.renew) clearInterval(held.renew);
        held.renew = undefined;
      }
    } catch (error) {
      held.controller.abort();
      if (held.renew) clearInterval(held.renew);
      held.renew = undefined;
      this.#logger.error(
        error instanceof Error ? error : new Error('schedule: renew failed'),
        { name },
      );
    }
  }

  async #compareDelete(key: string): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    await redis.eval(deleteScript, 1, key, this.#ownerId);
  }
}
