import { randomUUID } from 'node:crypto';
import { settleWithin } from '@hexok/ioredis-lifecycle';
import { describeRedisLifecycle, RedisProxy, runNode } from '@hexok/test-redis';
import { Redis, type RedisOptions } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronScheduler } from './cron-scheduler.js';
import type { LogSink } from './index.js';
import { RedisScheduleCoordinator } from './redis-schedule.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

function seam(): CronScheduler & {
  jobs: Array<{ fire: () => Promise<void> }>;
} {
  const jobs: Array<{ fire: () => Promise<void> }> = [];
  return {
    jobs,
    schedule(input) {
      const handle = {
        stop() {},
        fire: () => Promise.resolve(input.onTick()),
      };
      jobs.push(handle);
      return handle;
    },
  };
}

interface Logged {
  readonly error: unknown;
  readonly fields: Record<string, unknown> | undefined;
}

function recorder(): LogSink & { errors: Logged[] } {
  const errors: Logged[] = [];
  return {
    errors,
    debug() {},
    info() {},
    warn() {},
    error(error, fields) {
      errors.push({ error, fields });
    },
  };
}

/**
 * `register` is synchronous, and Redis work happens on a tick, which reports failures to the `LogSink` with the `job` field.
 * So `operate` registers a fresh job, fires its tick through the scheduler seam, and rethrows the error logged for that job.
 * `register` throws `NotStarted`, `Starting`, and `Stopped`. The lock `SET` rejects with `StoppedBeforeReply`.
 */
describeRedisLifecycle(
  'RedisScheduleCoordinator',
  ({ redis, stopTimeoutMs }) => {
    const scheduler = seam();
    const logger = recorder();
    const coordinator = new RedisScheduleCoordinator({
      redis,
      stopTimeoutMs,
      keyPrefix: `hexok:sched:it:${randomUUID()}:`,
      scheduler,
      logger,
    });
    let count = 0;
    return {
      start: () => coordinator.start(),
      stop: () => coordinator.stop(),
      async operate() {
        count += 1;
        const job = `job-${count}`;
        coordinator.register({ name: job, cron: '0 * * * *', onTick() {} });
        await scheduler.jobs.at(-1)?.fire();
        const failed = logger.errors.find((item) => item.fields?.job === job);
        if (failed) throw failed.error;
      },
    };
  },
);

describe.skipIf(!process.env.REDIS_URL)(
  'RedisScheduleCoordinator integration',
  () => {
    const clients: Redis[] = [];
    const coordinators: RedisScheduleCoordinator[] = [];

    afterEach(async () => {
      await Promise.all(coordinators.splice(0).map((item) => item.stop()));
      await Promise.all(clients.splice(0).map((redis) => redis.quit()));
    });

    it('skips a lock miss, compare-and-deletes, and aborts on stop', async () => {
      const url = process.env.REDIS_URL ?? '';
      const probe = new Redis(url);
      clients.push(probe);
      const prefix = `hexok:sched:it:${randomUUID()}:`;
      const left = seam();
      const right = seam();
      const a = new RedisScheduleCoordinator({
        redis: url,
        keyPrefix: prefix,
        scheduler: left,
        lockTtlSec: 30,
      });
      const b = new RedisScheduleCoordinator({
        redis: url,
        keyPrefix: prefix,
        scheduler: right,
        lockTtlSec: 30,
      });
      coordinators.push(a, b);
      await a.start();
      await b.start();
      let release: (() => void) | undefined;
      let ranB = 0;
      a.register({
        name: 'cleanup',
        cron: '0 * * * *',
        onTick: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
      b.register({
        name: 'cleanup',
        cron: '0 * * * *',
        onTick: () => {
          ranB += 1;
        },
      });
      const ticking = left.jobs[0]?.fire();
      // `onTick` runs only once A holds the lock.
      await vi.waitFor(() => expect(release).toBeDefined());
      await right.jobs[0]?.fire();
      expect(ranB).toBe(0);
      const key = `${prefix}lock:cleanup`;
      expect(await probe.get(key)).toEqual(expect.any(String));
      release?.();
      await ticking;
      expect(await probe.get(key)).toBeNull();

      let aborted = false;
      let releaseStop: (() => void) | undefined;
      a.register({
        name: 'stop-me',
        cron: '0 * * * *',
        onTick: (tick) =>
          new Promise((resolve) => {
            releaseStop = () => {
              aborted = tick.signal.aborted;
              resolve();
            };
          }),
      });
      const stoppingTick = left.jobs[1]?.fire();
      await vi.waitFor(() => expect(releaseStop).toBeDefined());
      await a.stop();
      expect(await probe.get(`${prefix}lock:stop-me`)).toBeNull();
      releaseStop?.();
      await stoppingTick;
      expect(aborted).toBe(true);
    });
  },
);

describe.skipIf(!process.env.REDIS_URL)(
  'RedisScheduleCoordinator lifecycle details',
  () => {
    const stopTimeoutMs = 500;
    const slackMs = 250;
    let proxy: RedisProxy;
    let redis: RedisOptions;
    let probe: Redis;
    let prefix: string;
    const coordinators: RedisScheduleCoordinator[] = [];

    function coordinator(
      scheduler: CronScheduler,
      logger: LogSink = recorder(),
    ): RedisScheduleCoordinator {
      const made = new RedisScheduleCoordinator({
        redis,
        keyPrefix: prefix,
        stopTimeoutMs,
        scheduler,
        logger,
      });
      coordinators.push(made);
      return made;
    }

    /** Registers a job whose tick holds the lock until its signal aborts, fires it, and waits until Redis has the lock. */
    async function hold(
      made: RedisScheduleCoordinator,
      scheduler: ReturnType<typeof seam>,
      job: string,
    ): Promise<{ ticking: Promise<void> }> {
      made.register({
        name: job,
        cron: '0 * * * *',
        onTick: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          }),
      });
      const ticking = scheduler.jobs.at(-1)?.fire() ?? Promise.resolve();
      await vi.waitFor(async () =>
        expect(await probe.get(`${prefix}lock:${job}`)).not.toBeNull(),
      );
      // Wrapped, because an async function would wait for a returned promise.
      return { ticking };
    }

    beforeEach(async () => {
      proxy = await RedisProxy.start();
      redis = { host: proxy.host, port: proxy.port, disconnectTimeout: 200 };
      probe = new Redis(process.env.REDIS_URL ?? '');
      prefix = `hexok:sched:it:${randomUUID()}:`;
    });

    afterEach(async () => {
      await Promise.all(coordinators.splice(0).map((made) => made.stop()));
      await proxy.close();
      await probe.quit();
    });

    it('releases held locks on a healthy stop and waits for running ticks', async () => {
      const scheduler = seam();
      const made = coordinator(scheduler);
      await made.start();
      let finished = 0;
      for (const job of ['a', 'b']) {
        made.register({
          name: job,
          cron: '0 * * * *',
          onTick: ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  // Cleanup after the abort, such as a final write, still finishes before stop() resolves.
                  setTimeout(() => {
                    finished += 1;
                    resolve();
                  }, 50);
                },
                { once: true },
              );
            }),
        });
        void scheduler.jobs.at(-1)?.fire();
      }
      await vi.waitFor(async () =>
        expect(await probe.exists(`${prefix}lock:a`, `${prefix}lock:b`)).toBe(
          2,
        ),
      );
      await made.stop();
      expect(finished).toBe(2);
      expect(await probe.exists(`${prefix}lock:a`, `${prefix}lock:b`)).toBe(0);
    });

    it('stop resolves within stopTimeoutMs while Redis refuses connections, with a lock held', async () => {
      const scheduler = seam();
      const made = coordinator(scheduler);
      await made.start();
      const { ticking } = await hold(made, scheduler, 'held');
      await proxy.refuse();
      proxy.drop();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await settleWithin(made.stop(), stopTimeoutMs + slackMs)).toBe(
        true,
      );
      expect(await settleWithin(ticking, 100)).toBe(true);
      // The release never reached Redis. The lock expires by its TTL.
      expect(await probe.pttl(`${prefix}lock:held`)).toBeGreaterThan(0);
    });

    it('stop resolves within stopTimeoutMs while Redis is blackholed, with a lock held', async () => {
      const scheduler = seam();
      const made = coordinator(scheduler);
      await made.start();
      const { ticking } = await hold(made, scheduler, 'held');
      proxy.blackhole();
      expect(await settleWithin(made.stop(), stopTimeoutMs + slackMs)).toBe(
        true,
      );
      expect(await settleWithin(ticking, 100)).toBe(true);
      expect(await probe.pttl(`${prefix}lock:held`)).toBeGreaterThan(0);
    });

    it('stop resolves within stopTimeoutMs while the client is reconnecting, with a lock held', async () => {
      const scheduler = seam();
      const made = coordinator(scheduler);
      await made.start();
      const { ticking } = await hold(made, scheduler, 'held');
      proxy.drop();
      expect(await settleWithin(made.stop(), stopTimeoutMs + slackMs)).toBe(
        true,
      );
      expect(await settleWithin(ticking, 100)).toBe(true);
    });

    it('a lock SET queued during an outage settles on stop and is logged with StoppedBeforeReply', async () => {
      const scheduler = seam();
      const logger = recorder();
      const made = coordinator(scheduler, logger);
      await made.start();
      await proxy.refuse();
      proxy.drop();
      await new Promise((resolve) => setTimeout(resolve, 100));
      let ran = false;
      made.register({
        name: 'queued',
        cron: '0 * * * *',
        onTick: () => {
          ran = true;
        },
      });
      const ticking = scheduler.jobs[0]?.fire() ?? Promise.resolve();
      expect(await settleWithin(made.stop(), stopTimeoutMs + slackMs)).toBe(
        true,
      );
      expect(await settleWithin(ticking, 100)).toBe(true);
      expect(ran).toBe(false);
      expect(logger.errors).toContainEqual({
        error: expect.objectContaining({ code: 'StoppedBeforeReply' }),
        fields: { adapter: 'schedule', connection: 'commands', job: 'queued' },
      });
    });

    it('state moves from idle through starting and ready to stopping and stopped', async () => {
      const made = coordinator(seam());
      expect(made.state).toBe('idle');
      const starting = made.start();
      expect(made.state).toBe('starting');
      await starting;
      expect(made.state).toBe('ready');
      const stopping = made.stop();
      expect(made.state).toBe('stopping');
      await stopping;
      expect(made.state).toBe('stopped');
      await made.start();
      expect(made.state).toBe('ready');
    });

    it('state returns to idle after a failed start', async () => {
      await proxy.refuse();
      const made = new RedisScheduleCoordinator({
        redis,
        startTimeoutMs: 200,
        scheduler: seam(),
      });
      coordinators.push(made);
      await expect(made.start()).rejects.toMatchObject({
        code: 'StartTimeout',
      });
      expect(made.state).toBe('idle');
    });

    it('starts again after stop, and the same job name registers again', async () => {
      const scheduler = seam();
      const made = coordinator(scheduler);
      let ran = 0;
      const job = {
        name: 'again',
        cron: '0 * * * *',
        onTick: () => {
          ran += 1;
        },
      };
      await made.start();
      made.register(job);
      await scheduler.jobs[0]?.fire();
      await made.stop();
      await made.start();
      made.register(job);
      await scheduler.jobs[1]?.fire();
      expect(ran).toBe(2);
    });

    it('register throws NotStarted before start and Starting while start is pending', async () => {
      const made = coordinator(seam());
      const job = { name: 'early', cron: '0 * * * *', onTick() {} };
      expect(() => made.register(job)).toThrow(
        expect.objectContaining({ code: 'NotStarted' }),
      );
      await proxy.refuse();
      const starting = made.start().catch((error: unknown) => error);
      expect(() => made.register(job)).toThrow(
        expect.objectContaining({ code: 'Starting' }),
      );
      await made.stop();
      expect(await starting).toMatchObject({ code: 'Stopped' });
      expect(() => made.register(job)).toThrow(
        expect.objectContaining({ code: 'Stopped' }),
      );
    });

    it('logs connection errors with the adapter fields, and ioredis prints no unhandled error event', async () => {
      await proxy.refuse();
      const entry = new URL('./index.ts', import.meta.url).href;
      const result = await runNode(
        `
import { RedisScheduleCoordinator } from ${JSON.stringify(entry)};
const logged = [];
const coordinator = new RedisScheduleCoordinator({
  redis: { host: '127.0.0.1', port: Number(process.env.PORT), disconnectTimeout: 200 },
  startTimeoutMs: 400,
  stopTimeoutMs: 300,
  logger: { debug() {}, info() {}, warn() {}, error: (error, fields) => logged.push(fields) },
});
const error = await coordinator.start().then(() => undefined, (error) => error);
await coordinator.stop();
console.log(JSON.stringify({ code: error?.code, logged }));
`,
        { env: { PORT: String(proxy.port) }, timeoutMs: 5000 },
      );
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      const { code, logged } = JSON.parse(result.stdout) as {
        code: string;
        logged: unknown[];
      };
      expect(code).toBe('StartTimeout');
      expect(logged[0]).toEqual({
        adapter: 'schedule',
        connection: 'commands',
      });
      // startTimeoutMs, then disconnectTimeout, then nothing holds the process.
      expect(result.ms).toBeLessThan(2000);
    });
  },
);
