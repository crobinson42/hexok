import { afterEach, describe, expect, it, vi } from 'vitest';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

class FakeRedis {
  static instances: FakeRedis[] = [];
  readonly calls: unknown[][] = [];
  pending: Pending | undefined;
  failTrim = false;

  constructor(..._args: unknown[]) {
    FakeRedis.instances.push(this);
  }

  xadd(...args: unknown[]): Promise<string> {
    this.calls.push(['xadd', ...args]);
    return Promise.resolve('1-0');
  }

  xtrim(...args: unknown[]): Promise<number> {
    this.calls.push(['xtrim', ...args]);
    if (this.failTrim) return Promise.reject(new Error('trim failed'));
    return Promise.resolve(0);
  }

  xgroup(...args: unknown[]): Promise<string> {
    this.calls.push(['xgroup', ...args]);
    return Promise.resolve('OK');
  }

  xreadgroup(...args: unknown[]): Promise<unknown> {
    this.calls.push(['xreadgroup', ...args]);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  xack(...args: unknown[]): Promise<number> {
    this.calls.push(['xack', ...args]);
    return Promise.resolve(1);
  }

  xclaim(...args: unknown[]): Promise<unknown[]> {
    this.calls.push(['xclaim', ...args]);
    return Promise.resolve([]);
  }

  xautoclaim(...args: unknown[]): Promise<unknown[]> {
    this.calls.push(['xautoclaim', ...args]);
    return Promise.resolve(['0-0', []]);
  }

  disconnect(): void {
    this.calls.push(['disconnect']);
    this.pending?.reject(new Error('Connection is closed'));
  }

  quit(): Promise<string> {
    this.calls.push(['quit']);
    return Promise.resolve('OK');
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis, default: FakeRedis }));

const { RedisQueue } = await import('./redis-queue.js');

describe('RedisQueue commands', () => {
  afterEach(async () => {
    vi.useRealTimers();
    FakeRedis.instances.length = 0;
  });

  it('XADDs with MAXLEN and trims age with a separate MINID', async () => {
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      retentionMs: 1000,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await expect(queue.publish('jobs', 'nope')).resolves.toBeTypeOf('string');
    const encodedThrow = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      encode: () => {
        throw new Error('bad encode');
      },
    });
    await encodedThrow.start();
    const before = FakeRedis.instances[1]?.calls.length ?? 0;
    await expect(encodedThrow.publish('jobs', { a: 1 })).rejects.toThrow(
      'bad encode',
    );
    expect(FakeRedis.instances[1]?.calls.length).toBe(before);

    const xadd = commands.calls.find((call) => call[0] === 'xadd');
    expect(xadd).toEqual([
      'xadd',
      'hexok:queue:jobs',
      'MAXLEN',
      '~',
      10000,
      '*',
      'payload',
      JSON.stringify('nope'),
    ]);
    expect(xadd).not.toContain('MINID');
    const xtrim = commands.calls.find((call) => call[0] === 'xtrim');
    expect(xtrim?.[2]).toBe('MINID');
    expect(xtrim).not.toContain('MAXLEN');

    commands.failTrim = true;
    await expect(queue.publish('jobs', { ok: true })).resolves.toBe('1-0');
    await queue.stop();
    await encodedThrow.stop();
  });

  it('does not XCLAIM an empty snapshot and places JUSTID after ids', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30,
      blockMs: 1000,
    });
    await queue.start();
    let release: (value: 'ack' | 'retry') => void = () => {};
    const gate = new Promise<'ack' | 'retry'>((resolve) => {
      release = resolve;
    });
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => gate,
    });
    await queue.subscribe('other', {
      consumerGroup: 'other',
      handler: async () => 'ack',
    });
    await vi.advanceTimersByTimeAsync(10);
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    expect(commands.calls.some((call) => call[0] === 'xclaim')).toBe(false);

    const blocking = FakeRedis.instances[1];
    if (!blocking) throw new Error('missing blocking client');
    blocking.pending?.resolve([
      ['hexok:queue:jobs', [['9-1', ['payload', '{"n":1}']]]],
    ]);
    await vi.waitFor(() => {
      expect(commands.calls.some((call) => call[0] === 'xclaim')).toBe(true);
    });
    const claim = commands.calls.find((call) => call[0] === 'xclaim');
    expect(claim?.[1]).toBe('hexok:queue:jobs');
    expect(claim?.[2]).toBe('billing');
    const just = claim?.lastIndexOf('JUSTID');
    const idAt = claim?.indexOf('9-1');
    expect(idAt).toBeGreaterThan(0);
    expect(just).toBe((claim?.length ?? 0) - 1);
    expect(idAt).toBeLessThan(just ?? 0);
    expect(
      commands.calls
        .filter((call) => call[0] === 'xclaim')
        .every((call) => {
          return call[1] === 'hexok:queue:jobs';
        }),
    ).toBe(true);
    expect(blocking.calls.some((call) => call[0] === 'xclaim')).toBe(false);

    release('retry');
    await vi.waitFor(() => {
      expect(commands.calls.some((call) => call[0] === 'xack')).toBe(false);
    });
    await queue.stop();
  });

  it('does not XACK after unsubscribe or stop', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30_000,
      blockMs: 1000,
    });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const blocking = FakeRedis.instances[1];
    blocking?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await Promise.resolve();
    await queue.unsubscribe('jobs', { consumerGroup: 'billing' });
    release('ack');
    await vi.waitFor(() => {
      const commands = FakeRedis.instances[0];
      expect(commands?.calls.some((call) => call[0] === 'xack')).toBe(false);
    });

    const queue2 = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 50,
    });
    await queue2.start();
    let release2: (value: 'ack') => void = () => {};
    await queue2.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: () =>
        new Promise((resolve) => {
          release2 = resolve;
        }),
    });
    const started = FakeRedis.instances.length;
    const blocking2 = FakeRedis.instances[started - 1];
    blocking2?.pending?.resolve([
      ['hexok:queue:jobs', [['4-2', ['payload', '{}']]]],
    ]);
    await Promise.resolve();
    const stopping = queue2.stop();
    release2('ack');
    await stopping;
    const commands2 = FakeRedis.instances[started - 2];
    expect(commands2?.calls.some((call) => call[0] === 'xack')).toBe(false);
    await queue.stop();
  });
});
