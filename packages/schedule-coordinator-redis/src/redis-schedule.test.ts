import { describe, expect, it, vi } from 'vitest';
import type { CronScheduler } from './cron-scheduler.js';

class FakeRedis {
  static instances: FakeRedis[] = [];
  failSet = false;
  renewResult: number = 1;
  readonly store = new Map<string, string>();

  constructor(..._args: unknown[]) {
    FakeRedis.instances.push(this);
  }

  async set(
    key: string,
    value: string,
    ...rest: unknown[]
  ): Promise<string | null> {
    if (this.failSet) throw new Error('SET failed');
    if (rest.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }

  async eval(
    script: string,
    _keys: number,
    key: string,
    owner: string,
  ): Promise<number> {
    if (script.includes('EXPIRE')) {
      if (this.store.get(key) !== owner) return 0;
      return this.renewResult;
    }
    if (this.store.get(key) !== owner) return 0;
    this.store.delete(key);
    return 1;
  }

  async quit(): Promise<string> {
    return 'OK';
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis, default: FakeRedis }));

const { RedisScheduleCoordinator } = await import('./redis-schedule.js');

function scheduler(): CronScheduler & {
  jobs: Array<{ fire: () => Promise<void>; stop: () => void }>;
} {
  const jobs: Array<{ fire: () => Promise<void>; stop: () => void }> = [];
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

describe('RedisScheduleCoordinator', () => {
  it('skips onTick when SET throws and aborts when renew returns 0', async () => {
    vi.useFakeTimers();
    const seam = scheduler();
    const coordinator = new RedisScheduleCoordinator({
      redis: 'redis://127.0.0.1:6379',
      lockTtlSec: 2,
      scheduler: seam,
    });
    await coordinator.start();
    const redis = FakeRedis.instances[0];
    if (!redis) throw new Error('missing redis');
    redis.failSet = true;
    let ran = 0;
    coordinator.register({
      name: 'cleanup',
      cron: '0 * * * *',
      onTick: () => {
        ran += 1;
      },
    });
    await seam.jobs[0]?.fire();
    expect(ran).toBe(0);

    redis.failSet = false;
    redis.renewResult = 0;
    let signal: AbortSignal | undefined;
    coordinator.register({
      name: 'renew',
      cron: '0 * * * *',
      onTick: async (tick) => {
        signal = tick.signal;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    });
    const ticking = seam.jobs[1]?.fire();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    await ticking;
    expect(redis.store.has('hexok:sched:lock:renew')).toBe(false);
    await coordinator.stop();
    vi.useRealTimers();
  });
});
