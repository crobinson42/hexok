import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParkInput } from './park.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

class FakeRedis {
  static instances: FakeRedis[] = [];
  readonly calls: unknown[][] = [];
  pending: Pending | undefined;
  failTrim = false;
  failXadd = false;

  constructor(..._args: unknown[]) {
    FakeRedis.instances.push(this);
  }

  xadd(...args: unknown[]): Promise<string> {
    this.calls.push(['xadd', ...args]);
    if (this.failXadd) return Promise.reject(new Error('xadd failed'));
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

  scanPages: Array<[string, string[]]> = [['0', []]];
  xinfoReplies = new Map<string, unknown>();
  failXinfo = new Map<string, Error>();
  #scanCursor = 0;

  scan(...args: unknown[]): Promise<[string, string[]]> {
    this.calls.push(['scan', ...args]);
    const page = this.scanPages[this.#scanCursor] ?? ['0', []];
    this.#scanCursor += 1;
    return Promise.resolve(page);
  }

  xinfo(...args: unknown[]): Promise<unknown> {
    this.calls.push(['xinfo', ...args]);
    const key = String(args[1]);
    const failure = this.failXinfo.get(key);
    if (failure) return Promise.reject(failure);
    const replyKey = args.map(String).join('\0');
    return Promise.resolve(this.xinfoReplies.get(replyKey) ?? []);
  }

  del(...args: unknown[]): Promise<number> {
    this.calls.push(['del', ...args]);
    return Promise.resolve(1);
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

  it('parks a failed publish and encode, and not a failed trim', async () => {
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.failXadd = true;
    await expect(queue.publish('jobs', { a: 1 })).rejects.toThrow(
      'xadd failed',
    );
    expect(parked[0]).toMatchObject({
      source: 'queue',
      operation: 'publish',
      subject: 'jobs',
      payload: { a: 1 },
      context: { adapter: 'redis' },
    });

    commands.failXadd = false;
    commands.failTrim = true;
    await expect(queue.publish('jobs', { ok: true })).resolves.toBe('1-0');
    expect(parked).toHaveLength(1);

    const encodedThrow = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine,
      encode: () => {
        throw new Error('bad encode');
      },
    });
    await encodedThrow.start();
    await expect(encodedThrow.publish('jobs', { b: 2 })).rejects.toThrow(
      'bad encode',
    );
    expect(parked.at(-1)).toMatchObject({
      operation: 'publish',
      payload: { b: 2 },
      error: { message: 'bad encode' },
    });

    const throwing = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine: {
        async park() {
          throw new Error('store down');
        },
      },
    });
    await throwing.start();
    const failing = FakeRedis.instances.at(-1);
    if (!failing) throw new Error('missing commands client');
    failing.failXadd = true;
    await expect(throwing.publish('jobs', { c: 3 })).rejects.toThrow(
      'xadd failed',
    );
    await queue.stop();
    await encodedThrow.stop();
    await throwing.stop();
  });

  it('parks a missing payload and a decode failure, and not a handler drop', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30_000,
      blockMs: 1000,
      quarantine,
      decode: () => {
        throw new Error('bad decode');
      },
    });
    await queue.start();
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => 'drop',
    });
    FakeRedis.instances[1]?.pending?.resolve([
      [
        'hexok:queue:jobs',
        [
          ['4-1', ['other', 'x']],
          ['4-2', ['payload', 'not-json']],
        ],
      ],
    ]);
    await vi.waitFor(() => {
      const acks =
        FakeRedis.instances[0]?.calls.filter((call) => call[0] === 'xack') ??
        [];
      expect(acks).toHaveLength(2);
    });
    expect(parked.map((item) => item.payload)).toEqual([
      { reason: 'missing-payload' },
      { reason: 'decode-failed', raw: 'not-json' },
    ]);
    expect(parked[0]?.subject).toBe('jobs:4-1');
    expect(parked[1]?.operation).toBe('deliver');
    await queue.stop();

    const dropped: ParkInput[] = [];
    const plain = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30_000,
      blockMs: 1000,
      quarantine: {
        async park(input: ParkInput) {
          dropped.push(input);
          return { id: 'q2' };
        },
      },
    });
    await plain.start();
    await plain.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => 'drop',
    });
    const started = FakeRedis.instances.length;
    FakeRedis.instances[started - 1]?.pending?.resolve([
      ['hexok:queue:jobs', [['8-1', ['payload', '{"n":1}']]]],
    ]);
    await vi.waitFor(() => {
      expect(
        FakeRedis.instances[started - 2]?.calls.some(
          (call) => call[0] === 'xack',
        ),
      ).toBe(true);
    });
    expect(dropped).toHaveLength(0);
    await plain.stop();
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
      expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
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
    expect(callsOf(commands2, 'DELCONSUMER')).toHaveLength(0);
    await queue.stop();
  });

  it('removes the local consumer on unsubscribe and stop when nothing is in flight', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30_000,
      blockMs: 1000,
    });
    await queue.start();
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await queue.unsubscribe('jobs', { consumerGroup: 'billing' });
    const dropped = callsOf(commands, 'DELCONSUMER');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.[2]).toBe('hexok:queue:jobs');
    expect(dropped[0]?.[3]).toBe('billing');
    expect(String(dropped[0]?.[4])).toMatch(/^hexok:/);

    await queue.subscribe('other', {
      consumerGroup: 'mail',
      handler: async () => 'ack',
    });
    await queue.stop();
    const stopped = callsOf(commands, 'DELCONSUMER');
    expect(stopped).toHaveLength(2);
    expect(stopped[1]?.[2]).toBe('hexok:queue:other');
    expect(stopped[1]?.[3]).toBe('mail');
    expect(String(stopped[1]?.[4])).toMatch(/^hexok:/);
  });

  it('maintain defaults to a dry run and does not write', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      retentionMs: 1000,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.scanPages = [['0', ['hexok:queue:jobs']]];
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 3,
      lastGeneratedId: old,
      groups: 1,
      firstId: old,
    });
    scriptGroup(commands, 'hexok:queue:jobs', {
      name: 'billing',
      consumers: 1,
      pending: 0,
      lastDeliveredId: old,
    });
    scriptConsumer(commands, 'hexok:queue:jobs', 'billing', {
      name: 'hexok:1:abc',
      pending: 0,
      idle: 50_000,
    });

    const report = await queue.maintain({
      idleConsumerMs: 1000,
      dropIdleGroups: { idleMs: 1000 },
      dropIdleStreams: { idleMs: 1000 },
    });

    expect(report).toEqual({
      dryRun: true,
      scanned: 1,
      trimmed: ['jobs'],
      consumersRemoved: [
        {
          topic: 'jobs',
          group: 'billing',
          consumer: 'hexok:1:abc',
          idleMs: 50_000,
        },
      ],
      groupsDestroyed: [{ topic: 'jobs', group: 'billing' }],
      streamsDeleted: [{ topic: 'jobs', length: 3 }],
      stuck: [],
      skipped: [],
    });
    expect(commands.calls.some((call) => call[0] === 'xtrim')).toBe(false);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    expect(callsOf(commands, 'DESTROY')).toHaveLength(0);
    expect(commands.calls.some((call) => call[0] === 'del')).toBe(false);
    const scan = commands.calls.find((call) => call[0] === 'scan');
    expect(scan).toEqual(['scan', '0', 'MATCH', 'hexok:queue:*', 'COUNT', 100]);
    await queue.stop();
  });

  it('maintain writes only the idle hexok consumer, then the opted-in group and stream', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      retentionMs: 1000,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 3,
      lastGeneratedId: old,
      groups: 1,
      firstId: old,
    });
    scriptGroup(commands, 'hexok:queue:jobs', {
      name: 'billing',
      consumers: 1,
      pending: 0,
      lastDeliveredId: old,
    });
    scriptConsumer(commands, 'hexok:queue:jobs', 'billing', {
      name: 'hexok:1:abc',
      pending: 0,
      idle: 50_000,
    });
    const options = {
      dryRun: false,
      topics: ['jobs'],
      idleConsumerMs: 1000,
      dropIdleGroups: { idleMs: 1000 },
      dropIdleStreams: { idleMs: 1000 },
    };

    const report = await queue.maintain(options);

    expect(report.dryRun).toBe(false);
    expect(report.consumersRemoved).toEqual([
      {
        topic: 'jobs',
        group: 'billing',
        consumer: 'hexok:1:abc',
        idleMs: 50_000,
      },
    ]);
    expect(callsOf(commands, 'DELCONSUMER')).toEqual([
      ['xgroup', 'DELCONSUMER', 'hexok:queue:jobs', 'billing', 'hexok:1:abc'],
    ]);
    expect(callsOf(commands, 'DESTROY')).toEqual([
      ['xgroup', 'DESTROY', 'hexok:queue:jobs', 'billing'],
    ]);
    expect(commands.calls.some((call) => call[0] === 'del')).toBe(true);
    expect(commands.calls.some((call) => call[0] === 'scan')).toBe(false);
    const xtrim = commands.calls.find((call) => call[0] === 'xtrim');
    expect(xtrim?.[1]).toBe('hexok:queue:jobs');
    expect(xtrim?.[2]).toBe('MINID');
    await queue.stop();
  });

  it('leaves a pending idle consumer and reports stuck groups', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 1,
      lastGeneratedId: '1-0',
      groups: 1,
      firstId: '1-0',
    });
    scriptGroup(commands, 'hexok:queue:jobs', {
      name: 'billing',
      consumers: 1,
      pending: 4,
      lastDeliveredId: '1-0',
    });
    scriptConsumer(commands, 'hexok:queue:jobs', 'billing', {
      name: 'hexok:1:abc',
      pending: 4,
      idle: 50_000,
    });
    scriptStream(commands, 'hexok:queue:other', {
      length: 2,
      lastGeneratedId: '1-0',
      groups: 1,
      firstId: '1-0',
    });
    scriptGroup(commands, 'hexok:queue:other', {
      name: 'mail',
      consumers: 0,
      pending: 2,
      lastDeliveredId: '1-0',
    });

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs', 'other'],
      idleConsumerMs: 1000,
    });

    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    expect(report.consumersRemoved).toEqual([]);
    expect(report.stuck).toEqual([
      {
        topic: 'jobs',
        group: 'billing',
        pending: 4,
        reason: 'pending-owned-by-idle-consumer',
      },
      {
        topic: 'other',
        group: 'mail',
        pending: 2,
        reason: 'no-consumers',
      },
    ]);
    await queue.stop();
  });

  it('does not remove a consumer this package did not create', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 0,
      lastGeneratedId: '1-0',
      groups: 1,
    });
    scriptGroup(commands, 'hexok:queue:jobs', {
      name: 'billing',
      consumers: 1,
      pending: 0,
      lastDeliveredId: '1-0',
    });
    scriptConsumer(commands, 'hexok:queue:jobs', 'billing', {
      name: 'other:1',
      pending: 0,
      idle: 50_000,
    });

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      idleConsumerMs: 1000,
    });

    expect(report.consumersRemoved).toEqual([]);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    await queue.stop();
  });

  it('destroys an idle group only when asked, and never a 0-0 group', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    for (const [topic, lastDeliveredId] of [
      ['old', old],
      ['fresh', '0-0'],
    ] as const) {
      const key = `hexok:queue:${topic}`;
      scriptStream(commands, key, {
        length: 1,
        lastGeneratedId: old,
        groups: 1,
        firstId: old,
      });
      scriptGroup(commands, key, {
        name: 'billing',
        consumers: 0,
        pending: 0,
        lastDeliveredId,
      });
    }

    const kept = await queue.maintain({
      dryRun: false,
      topics: ['old', 'fresh'],
    });
    expect(kept.groupsDestroyed).toEqual([]);
    expect(callsOf(commands, 'DESTROY')).toHaveLength(0);

    const dropped = await queue.maintain({
      dryRun: false,
      topics: ['old', 'fresh'],
      dropIdleGroups: { idleMs: 1000 },
    });
    expect(dropped.groupsDestroyed).toEqual([
      { topic: 'old', group: 'billing' },
    ]);
    expect(dropped.skipped).toEqual([
      { key: 'hexok:queue:fresh', reason: 'never-delivered' },
    ]);
    expect(callsOf(commands, 'DESTROY')).toEqual([
      ['xgroup', 'DESTROY', 'hexok:queue:old', 'billing'],
    ]);
    await queue.stop();
  });

  it('deletes an idle groupless stream only when asked, and never a 0-0 stream', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:kept', {
      length: 1,
      lastGeneratedId: old,
      groups: 1,
      firstId: old,
    });
    scriptGroup(commands, 'hexok:queue:kept', {
      name: 'billing',
      consumers: 0,
      pending: 0,
      lastDeliveredId: old,
    });
    scriptStream(commands, 'hexok:queue:empty', {
      length: 0,
      lastGeneratedId: old,
      groups: 0,
    });
    scriptStream(commands, 'hexok:queue:fresh', {
      length: 0,
      lastGeneratedId: '0-0',
      groups: 0,
    });

    const kept = await queue.maintain({
      dryRun: false,
      topics: ['kept', 'empty', 'fresh'],
    });
    expect(kept.streamsDeleted).toEqual([]);
    expect(commands.calls.some((call) => call[0] === 'del')).toBe(false);

    const dropped = await queue.maintain({
      dryRun: false,
      topics: ['kept', 'empty', 'fresh'],
      dropIdleStreams: { idleMs: 1000 },
    });
    expect(dropped.streamsDeleted).toEqual([{ topic: 'empty', length: 0 }]);
    expect(dropped.skipped).toContainEqual({
      key: 'hexok:queue:fresh',
      reason: 'never-written',
    });
    expect(commands.calls.filter((call) => call[0] === 'del')).toEqual([
      ['del', 'hexok:queue:empty'],
    ]);
    await queue.stop();
  });

  it('continues the scan when one key cannot be inspected', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.scanPages = [
      ['17', ['hexok:queue:bad']],
      ['0', ['hexok:queue:good']],
    ];
    commands.failXinfo.set('hexok:queue:bad', new Error('xinfo failed'));
    scriptStream(commands, 'hexok:queue:good', {
      length: 0,
      lastGeneratedId: '0-0',
      groups: 0,
    });

    const report = await queue.maintain();

    expect(report.scanned).toBe(2);
    expect(report.skipped).toEqual([
      { key: 'hexok:queue:bad', reason: 'xinfo-failed' },
    ]);
    expect(
      commands.calls
        .filter((call) => call[0] === 'xinfo')
        .map((call) => call[1]),
    ).toEqual(['STREAM', 'STREAM', 'GROUPS']);
    await queue.stop();
  });

  it('maintain before start throws', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await expect(queue.maintain()).rejects.toThrow(
      'queue: start() was not called',
    );
  });
});

describe('RedisQueue lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeRedis.instances.length = 0;
  });

  it('stop leaves no timer behind without subscriptions', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await queue.publish('jobs', { n: 1 });
    await queue.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop leaves no timer behind with a subscription', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    await queue.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop cancels a read loop backoff', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const blocking = FakeRedis.instances[1];
    if (!blocking) throw new Error('missing blocking client');
    blocking.pending?.reject(new Error('LOADING'));
    await vi.advanceTimersByTimeAsync(0);
    const stopping = queue.stop().then(() => 'stopped');
    const waited = vi.advanceTimersByTimeAsync(500).then(() => 'waiting');
    await expect(Promise.race([stopping, waited])).resolves.toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
});

function callsOf(
  commands: { calls: unknown[][] } | undefined,
  subcommand: string,
): unknown[][] {
  return (
    commands?.calls.filter(
      (call) => call[0] === 'xgroup' && call[1] === subcommand,
    ) ?? []
  );
}

function scriptStream(
  commands: FakeRedis,
  key: string,
  fields: {
    length: number;
    lastGeneratedId: string;
    groups: number;
    firstId?: string;
  },
): void {
  commands.xinfoReplies.set(['STREAM', key].join('\0'), [
    'length',
    fields.length,
    'last-generated-id',
    fields.lastGeneratedId,
    'groups',
    fields.groups,
    'first-entry',
    fields.firstId ? [fields.firstId, ['payload', '{}']] : null,
  ]);
}

function scriptGroup(
  commands: FakeRedis,
  key: string,
  group: {
    name: string;
    consumers: number;
    pending: number;
    lastDeliveredId: string;
  },
): void {
  const current = commands.xinfoReplies.get(['GROUPS', key].join('\0'));
  const groups = Array.isArray(current) ? current : [];
  groups.push([
    'name',
    group.name,
    'consumers',
    group.consumers,
    'pending',
    group.pending,
    'last-delivered-id',
    group.lastDeliveredId,
  ]);
  commands.xinfoReplies.set(['GROUPS', key].join('\0'), groups);
}

function scriptConsumer(
  commands: FakeRedis,
  key: string,
  group: string,
  consumer: { name: string; pending: number; idle: number },
): void {
  const replyKey = ['CONSUMERS', key, group].join('\0');
  const current = commands.xinfoReplies.get(replyKey);
  const consumers = Array.isArray(current) ? current : [];
  consumers.push([
    'name',
    consumer.name,
    'pending',
    consumer.pending,
    'idle',
    consumer.idle,
  ]);
  commands.xinfoReplies.set(replyKey, consumers);
}
