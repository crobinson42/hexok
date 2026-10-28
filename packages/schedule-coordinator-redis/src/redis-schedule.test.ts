import { describe, expect, it, vi } from 'vitest';
import type { CronScheduler } from './cron-scheduler.js';

class FakeRedis {
  static instances: FakeRedis[] = [];
  failSet = false;
  renewResult: number = 1;
  /** When set, `SET` waits for it, like a reply that has not arrived. */
  setGate: Promise<void> | undefined;
  /** When set, a renew waits for it. */
  renewGate: Promise<void> | undefined;
  /** When set, a release waits for it, like a command held during a partition. */
  releaseGate: Promise<void> | undefined;
  readonly calls: string[] = [];
  /** Replace it to share keys between clients, as one Redis would. */
  store = new Map<string, string>();
  // The lifecycle reads `status` and adds an `error` listener.
  status = 'ready';

  constructor(..._args: unknown[]) {
    FakeRedis.instances.push(this);
  }

  async set(
    key: string,
    value: string,
    ...rest: unknown[]
  ): Promise<string | null> {
    this.calls.push('set');
    await this.setGate;
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
    this.calls.push(script.includes('EXPIRE') ? 'renew' : 'release');
    if (script.includes('EXPIRE')) {
      await this.renewGate;
      if (this.store.get(key) !== owner) return 0;
      return this.renewResult;
    }
    await this.releaseGate;
    if (this.store.get(key) !== owner) return 0;
    this.store.delete(key);
    return 1;
  }

  async quit(): Promise<string> {
    this.status = 'end';
    return 'OK';
  }

  disconnect(): void {
    this.status = 'end';
  }

  on(): this {
    return this;
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis, default: FakeRedis }));

const { RedisScheduleCoordinator } = await import('./redis-schedule.js');
const { CronPackageScheduler } = await import('./cron-scheduler.js');

function latest(): FakeRedis {
  const redis = FakeRedis.instances.at(-1);
  if (!redis) throw new Error('missing redis');
  return redis;
}

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

  it('leaves no timers after stop, with a cron tick running and a warn timer set', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RedisScheduleCoordinator({
        redis: 'redis://127.0.0.1:6379',
        lockTtlSec: 2,
        scheduler: new CronPackageScheduler(),
      });
      await coordinator.start();
      let finished = false;
      coordinator.register({
        name: 'long',
        cron: '0 * * * *',
        runOnRegister: true,
        warnAfterMs: 60_000,
        onTick: ({ signal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                finished = true;
                resolve();
              },
              { once: true },
            );
          }),
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(latest().store.has('hexok:sched:lock:long')).toBe(true);
      // The count when stop() resolves. Advancing time afterwards would hide a timer stop() left running.
      const timersAtStop = coordinator.stop().then(() => vi.getTimerCount());
      await vi.advanceTimersByTimeAsync(1000);
      expect(await timersAtStop).toBe(0);
      expect(finished).toBe(true);
      expect(latest().store.has('hexok:sched:lock:long')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tick whose lock arrives after stop begins does not run onTick, and each lock is released once', async () => {
    const seam = scheduler();
    const coordinator = new RedisScheduleCoordinator({
      redis: 'redis://127.0.0.1:6379',
      scheduler: seam,
    });
    await coordinator.start();
    const redis = latest();
    let ran = 0;
    coordinator.register({
      name: 'running',
      cron: '0 * * * *',
      onTick: ({ signal }) =>
        new Promise<void>((resolve) => {
          ran += 1;
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    });
    const running = seam.jobs[0]?.fire();
    await vi.waitFor(() => expect(ran).toBe(1));

    let openGate: () => void = () => {};
    redis.setGate = new Promise((resolve) => {
      openGate = resolve;
    });
    coordinator.register({
      name: 'late',
      cron: '0 * * * *',
      onTick: () => {
        ran += 1;
      },
    });
    const late = seam.jobs[1]?.fire();
    await vi.waitFor(() => expect(redis.calls).toEqual(['set', 'set']));

    const stopping = coordinator.stop();
    // Redis grants the late lock after stop() began.
    openGate();
    await stopping;
    await running;
    await late;
    expect(ran).toBe(1);
    // The running tick releases its lock once it finishes. The late tick releases its lock without running onTick.
    expect(redis.calls).toEqual(['set', 'set', 'release', 'release']);
  });

  it('aborts the tick before the lock can expire when a renew does not answer', async () => {
    vi.useFakeTimers();
    try {
      const seam = scheduler();
      const warned: unknown[] = [];
      const coordinator = new RedisScheduleCoordinator({
        redis: 'redis://127.0.0.1:6379',
        lockTtlSec: 2,
        scheduler: seam,
        logger: {
          debug() {},
          info() {},
          warn: (_message, fields) => warned.push(fields),
          error() {},
        },
      });
      await coordinator.start();
      latest().renewGate = new Promise(() => {});
      let signal: AbortSignal | undefined;
      coordinator.register({
        name: 'slow-renew',
        cron: '0 * * * *',
        onTick: (tick) =>
          new Promise<void>((resolve) => {
            signal = tick.signal;
            tick.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          }),
      });
      const ticking = seam.jobs[0]?.fire();
      // Renews never answer. The lock is valid until 2000ms after SET was sent.
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal?.aborted).toBe(false);
      // The tick aborts at 1500ms, the TTL less a margin of min(1000, TTL / 4).
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal?.aborted).toBe(true);
      expect(warned).toEqual([
        { adapter: 'schedule', connection: 'commands', job: 'slow-renew' },
      ]);
      await ticking;
      // stop() waits for the unanswered renew until stopTimeoutMs.
      const stopping = coordinator.stop();
      await vi.advanceTimersByTimeAsync(5000);
      await stopping;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late release from an earlier session does not delete a later lock', async () => {
    const seam = scheduler();
    const coordinator = new RedisScheduleCoordinator({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 100,
      scheduler: seam,
    });
    const key = 'hexok:sched:lock:token';
    await coordinator.start();
    const first = latest();
    let heal: () => void = () => {};
    // The release is sent during a partition, and Redis runs it after the partition heals.
    first.releaseGate = new Promise((resolve) => {
      heal = resolve;
    });
    coordinator.register({ name: 'token', cron: '0 * * * *', onTick() {} });
    const ticking = seam.jobs[0]?.fire();
    await vi.waitFor(() => expect(first.calls).toContain('release'));
    await coordinator.stop();
    await ticking;
    // The first lock expires by its TTL.
    first.store.delete(key);

    await coordinator.start();
    const second = latest();
    second.store = first.store;
    let heldAfterHeal = false;
    coordinator.register({
      name: 'token',
      cron: '0 * * * *',
      onTick: async () => {
        heal();
        await new Promise((resolve) => setTimeout(resolve, 10));
        heldAfterHeal = first.store.has(key);
      },
    });
    await seam.jobs[1]?.fire();
    expect(heldAfterHeal).toBe(true);
    expect(first.store.has(key)).toBe(false);
    await coordinator.stop();
  });

  it('stop() called from inside onTick does not wait for that tick', async () => {
    const coordinator = new RedisScheduleCoordinator({
      redis: 'redis://127.0.0.1:6379',
      scheduler: new CronPackageScheduler(),
    });
    await coordinator.start();
    let stopMs = -1;
    await new Promise<void>((resolve) => {
      coordinator.register({
        name: 'self-stop',
        cron: '0 * * * *',
        runOnRegister: true,
        onTick: async () => {
          const started = Date.now();
          await coordinator.stop();
          stopMs = Date.now() - started;
          resolve();
        },
      });
    });
    expect(stopMs).toBeLessThan(1000);
    expect(coordinator.state).toBe('stopped');
  });
});
