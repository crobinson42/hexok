import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import type { CronScheduler } from './cron-scheduler.js';
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
      let release: () => void = () => {};
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      await right.jobs[0]?.fire();
      expect(ranB).toBe(0);
      const key = `${prefix}lock:cleanup`;
      expect(await probe.get(key)).toEqual(expect.any(String));
      release();
      await ticking;
      expect(await probe.get(key)).toBeNull();

      let aborted = false;
      let releaseStop: () => void = () => {};
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
      await new Promise((resolve) => setTimeout(resolve, 30));
      await a.stop();
      expect(await probe.get(`${prefix}lock:stop-me`)).toBeNull();
      releaseStop();
      await stoppingTick;
      expect(aborted).toBe(true);
    });
  },
);
