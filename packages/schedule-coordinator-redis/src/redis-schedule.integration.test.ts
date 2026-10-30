import { randomUUID } from 'node:crypto';
import {
  describeRedisLifecycle,
  documentedAclRules,
  RedisProxy,
  runNode,
  settleWithin,
  withAclUser,
} from '@hexok/test-redis';
import { Redis, type RedisOptions } from 'ioredis';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
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

interface Warned {
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

function recorder(): LogSink & { errors: Logged[]; warnings: Warned[] } {
  const errors: Logged[] = [];
  const warnings: Warned[] = [];
  return {
    errors,
    warnings,
    debug() {},
    info() {},
    warn(message, fields) {
      warnings.push({ message, fields });
    },
    error(error, fields) {
      errors.push({ error, fields });
    },
  };
}

/**
 * `register` is synchronous, and Redis work happens on a tick, which reports failures to the `LogSink` with the `job` field.
 * So `operate` registers a fresh job, fires its tick through the scheduler seam, and turns what was logged for that job into a rejection.
 * `register` throws `NotStarted`, `Starting`, and `Stopped`. A lock `SET` cut short by `stop()` is logged at `warn` with `code: 'StoppedBeforeReply'`.
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
    async function tick(): Promise<void> {
      count += 1;
      const job = `job-${count}`;
      coordinator.register({ name: job, cron: '0 * * * *', onTick() {} });
      await scheduler.jobs.at(-1)?.fire();
      const failed = logger.errors.find((item) => item.fields?.job === job);
      if (failed) throw failed.error;
      const warned = logger.warnings.find(
        (item) => item.fields?.job === job && item.fields.code !== undefined,
      );
      if (warned) {
        throw Object.assign(new Error(warned.message), {
          code: warned.fields?.code,
        });
      }
    }
    return {
      start: () => coordinator.start(),
      stop: () => coordinator.stop(),
      operate: tick,
      // The suite calls stop() right after this, while the lock SET is in flight. A healthy stop lets it settle and releases the lock.
      inFlight: tick,
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
      const stopping = a.stop();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The tick still runs, so it still holds its lock.
      expect(await probe.get(`${prefix}lock:stop-me`)).toEqual(
        expect.any(String),
      );
      releaseStop?.();
      await stopping;
      await stoppingTick;
      expect(aborted).toBe(true);
      expect(await probe.get(`${prefix}lock:stop-me`)).toBeNull();
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

    /** Registers a job whose tick holds the lock until its signal aborts, fires it, and waits until onTick runs. */
    async function hold(
      made: RedisScheduleCoordinator,
      scheduler: ReturnType<typeof seam>,
      job: string,
    ): Promise<{ ticking: Promise<void> }> {
      let running = false;
      made.register({
        name: job,
        cron: '0 * * * *',
        onTick: ({ signal }) =>
          new Promise((resolve) => {
            running = true;
            signal.addEventListener('abort', () => resolve(), { once: true });
          }),
      });
      const ticking = scheduler.jobs.at(-1)?.fire() ?? Promise.resolve();
      // onTick runs once the coordinator has the SET reply. Redis can show the key a moment earlier.
      await vi.waitFor(() => expect(running).toBe(true));
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
      let started = 0;
      let finished = 0;
      for (const job of ['a', 'b']) {
        made.register({
          name: job,
          cron: '0 * * * *',
          onTick: ({ signal }) =>
            new Promise((resolve) => {
              started += 1;
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
      await vi.waitFor(() => expect(started).toBe(2));
      await made.stop();
      expect(finished).toBe(2);
      expect(await probe.exists(`${prefix}lock:a`, `${prefix}lock:b`)).toBe(0);
    });

    it('another process does not take the lock until a stopping tick has finished', async () => {
      const left = seam();
      const right = seam();
      const a = coordinator(left);
      const b = new RedisScheduleCoordinator({
        redis: process.env.REDIS_URL ?? '',
        keyPrefix: prefix,
        scheduler: right,
      });
      coordinators.push(b);
      await a.start();
      await b.start();
      let running = false;
      let finishedAt = 0;
      let acquiredAt = 0;
      a.register({
        name: 'overlap',
        cron: '0 * * * *',
        onTick: ({ signal }) =>
          new Promise((resolve) => {
            running = true;
            // The tick honours its signal and takes 300ms to wind down.
            signal.addEventListener(
              'abort',
              () => {
                setTimeout(() => {
                  finishedAt = Date.now();
                  resolve();
                }, 300);
              },
              { once: true },
            );
          }),
      });
      b.register({
        name: 'overlap',
        cron: '0 * * * *',
        onTick: () => {
          acquiredAt = Date.now();
        },
      });
      void left.jobs[0]?.fire();
      await vi.waitFor(() => expect(running).toBe(true));
      const stopping = a.stop();
      await vi.waitFor(
        async () => {
          await right.jobs[0]?.fire();
          expect(acquiredAt).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 5 },
      );
      await stopping;
      expect(finishedAt).toBeGreaterThan(0);
      expect(acquiredAt).toBeGreaterThanOrEqual(finishedAt);
    });

    it('a process cut off from Redis aborts its tick before another process can take the lock', async () => {
      const left = seam();
      const right = seam();
      const a = new RedisScheduleCoordinator({
        redis,
        keyPrefix: prefix,
        lockTtlSec: 2,
        stopTimeoutMs,
        scheduler: left,
      });
      const b = new RedisScheduleCoordinator({
        redis: process.env.REDIS_URL ?? '',
        keyPrefix: prefix,
        lockTtlSec: 2,
        scheduler: right,
      });
      coordinators.push(a, b);
      await a.start();
      await b.start();
      let running = false;
      let abortedAt = 0;
      let acquiredAt = 0;
      a.register({
        name: 'partition',
        cron: '0 * * * *',
        onTick: ({ signal }) =>
          new Promise((resolve) => {
            running = true;
            signal.addEventListener(
              'abort',
              () => {
                abortedAt = Date.now();
                resolve();
              },
              { once: true },
            );
          }),
      });
      b.register({
        name: 'partition',
        cron: '0 * * * *',
        onTick: () => {
          acquiredAt = Date.now();
        },
      });
      void left.jobs[0]?.fire();
      await vi.waitFor(() => expect(running).toBe(true));
      proxy.blackhole();
      await vi.waitFor(
        async () => {
          await right.jobs[0]?.fire();
          expect(acquiredAt).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 5 },
      );
      expect(abortedAt).toBeGreaterThan(0);
      // The abort margin is min(1000, TTL / 4), 500ms here. Half of it allows for timer and event-loop lag.
      expect(acquiredAt - abortedAt).toBeGreaterThanOrEqual(250);
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

    it('a lock SET queued during an outage settles on stop and is logged at warn with StoppedBeforeReply', async () => {
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
      // Connection errors are logged while Redis refuses. Nothing about the job is an error.
      expect(logger.errors.filter((item) => item.fields?.job)).toEqual([]);
      expect(logger.warnings).toContainEqual({
        message:
          'schedule: stop() stopped waiting before Redis replied to the lock SET. Redis may or may not have run it.',
        fields: {
          adapter: 'schedule',
          connection: 'commands',
          job: 'queued',
          code: 'StoppedBeforeReply',
        },
      });
    });

    it('a lock SET answered after the lock could expire releases the lock without running onTick', async () => {
      const warnings: string[] = [];
      const onWarning = (warning: Error) => warnings.push(warning.name);
      process.on('warning', onWarning);
      try {
        const scheduler = seam();
        const logger = recorder();
        const made = new RedisScheduleCoordinator({
          redis,
          keyPrefix: prefix,
          lockTtlSec: 2,
          stopTimeoutMs,
          scheduler,
          logger,
        });
        coordinators.push(made);
        await made.start();
        await proxy.refuse();
        proxy.drop();
        let ran = false;
        made.register({
          name: 'late',
          cron: '0 * * * *',
          onTick: () => {
            ran = true;
          },
        });
        let settled = false;
        const ticking = scheduler.jobs[0]?.fire().then(() => {
          settled = true;
        });
        // The SET waits in the offline queue longer than the TTL less its margin of 500ms.
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await proxy.restore();
        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 5000 });
        await ticking;
        expect(ran).toBe(false);
        expect(await probe.get(`${prefix}lock:late`)).toBeNull();
        expect(logger.warnings).toContainEqual({
          message:
            'schedule: the lock SET was answered too late to run the tick safely, so the lock was released.',
          fields: { adapter: 'schedule', connection: 'commands', job: 'late' },
        });
        expect(warnings).not.toContain('TimeoutNegativeWarning');
      } finally {
        process.off('warning', onWarning);
      }
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

describe.skipIf(!process.env.REDIS_URL)('RedisScheduleCoordinator ACL', () => {
  it('takes, renews, and releases a lock as the documented user with no refusal', async () => {
    const url = process.env.REDIS_URL ?? '';
    const rules = await documentedAclRules(
      new URL('../README.md', import.meta.url),
    );
    const admin = new Redis(url);
    const keyPrefix = `hexok:sched:it:${randomUUID()}:`;
    const lock = `${keyPrefix}lock:acl`;
    try {
      await withAclUser(url, rules, async (user) => {
        const scheduler = seam();
        const logs = recorder();
        const jobs = new RedisScheduleCoordinator({
          redis: user.url,
          keyPrefix,
          lockTtlSec: 1,
          logger: logs,
          scheduler,
        });
        onTestFinished(() => jobs.stop());
        await jobs.start();
        let aborted = false;
        let held: string | null = null;
        jobs.register({
          name: 'acl',
          cron: '* * * * *',
          onTick: async ({ signal }) => {
            held = await admin.get(lock);
            // Longer than the renew interval, a third of the TTL.
            await new Promise((resolve) => setTimeout(resolve, 500));
            aborted = signal.aborted;
          },
        });
        await scheduler.jobs[0]?.fire();
        await jobs.stop();
        expect(held).toEqual(expect.any(String));
        expect(aborted).toBe(false);
        expect(await admin.get(lock)).toBeNull();
        expect(logs.errors).toEqual([]);
        expect(logs.warnings).toEqual([]);
        expect(await user.refusals()).toEqual([]);
      });
    } finally {
      await admin.del(lock);
      await admin.quit();
    }
  });
});
