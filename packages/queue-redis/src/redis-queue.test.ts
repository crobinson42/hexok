import { EventEmitter } from 'node:events';
import type { QueueMaxDeliveries, QueueSubscribeOptions } from '@hexok/queue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParkInput } from './park.js';
import {
  ackDeletedScript,
  deleteIdleStreamScript,
  destroyIdleGroupScript,
  releaseConsumer,
  releaseConsumerScript,
} from './scripts.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

class FakeRedis extends EventEmitter {
  static instances: FakeRedis[] = [];
  static initialStatus = 'ready';
  readonly calls: unknown[][] = [];
  pending: Pending | undefined;
  failTrim = false;
  failXadd = false;
  failCreate: Error | undefined;
  failXautoclaim: Error | undefined;
  autoclaimEntries: unknown[] = [];
  holdCreate = false;
  heldCreate: Pending | undefined;
  /** Commands never settle, as on a socket that stopped answering. */
  stalled = false;
  /** A reconnecting client: commands sit in the offline queue and `disconnect` does not flush them. */
  offline = false;
  status = FakeRedis.initialStatus;

  constructor(..._args: unknown[]) {
    super();
    FakeRedis.instances.push(this);
  }

  connect(): Promise<void> {
    this.calls.push(['connect']);
    this.status = 'connecting';
    return Promise.resolve();
  }

  becomeReady(): void {
    this.status = 'ready';
    this.emit('ready');
  }

  goOffline(): void {
    this.status = 'reconnecting';
    this.offline = true;
  }

  #stuck(): boolean {
    return this.stalled || this.offline;
  }

  xadd(...args: unknown[]): Promise<string> {
    this.calls.push(['xadd', ...args]);
    if (this.#stuck()) return new Promise(() => {});
    if (this.failXadd) {
      // ioredis puts the command and its args on a ReplyError.
      const error = Object.assign(new Error('xadd failed'), {
        command: { name: 'xadd', args: args.map(String) },
      });
      error.name = 'ReplyError';
      return Promise.reject(error);
    }
    return Promise.resolve('1-0');
  }

  xtrim(...args: unknown[]): Promise<number> {
    this.calls.push(['xtrim', ...args]);
    if (this.failTrim) return Promise.reject(new Error('trim failed'));
    return Promise.resolve(0);
  }

  xgroup(...args: unknown[]): Promise<string> {
    this.calls.push(['xgroup', ...args]);
    if (this.#stuck()) return new Promise(() => {});
    if (args[0] === 'DESTROY') {
      const replyKey = ['GROUPS', args[1]].join('\0');
      const groups = this.xinfoReplies.get(replyKey);
      if (Array.isArray(groups)) {
        this.xinfoReplies.set(
          replyKey,
          groups.filter((row: unknown[]) => row[1] !== args[2]),
        );
      }
    }
    if (args[0] === 'DELCONSUMER') {
      const replyKey = ['CONSUMERS', args[1], args[2]].join('\0');
      const consumers = this.xinfoReplies.get(replyKey);
      if (Array.isArray(consumers)) {
        this.xinfoReplies.set(
          replyKey,
          consumers.filter((row: unknown[]) => row[1] !== args[3]),
        );
      }
    }
    if (args[0] === 'CREATE' && this.failCreate) {
      return Promise.reject(this.failCreate);
    }
    if (args[0] === 'CREATE' && this.holdCreate) {
      return new Promise((resolve, reject) => {
        this.heldCreate = { resolve: () => resolve('OK'), reject };
      });
    }
    return Promise.resolve('OK');
  }

  xreadgroup(...args: unknown[]): Promise<unknown> {
    this.calls.push(['xreadgroup', ...args]);
    if (this.offline) return new Promise(() => {});
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  /** XPENDING replies by consumer name. A consumer not listed owns nothing. */
  pendingByConsumer = new Map<string, unknown[]>();

  /** XPENDING replies by entry id. An id not listed counts as one delivery. */
  pendingById = new Map<string, unknown[]>();

  holdXpending = false;
  heldXpending: Pending | undefined;

  xpending(...args: unknown[]): Promise<unknown[]> {
    this.calls.push(['xpending', ...args]);
    const reply = this.#pendingReply(args);
    if (this.holdXpending) {
      this.holdXpending = false;
      return new Promise((resolve, reject) => {
        this.heldXpending = { resolve: () => resolve(reply), reject };
      });
    }
    return Promise.resolve(reply);
  }

  #pendingReply(args: unknown[]): unknown[] {
    if (args.length >= 6) {
      return this.pendingByConsumer.get(String(args[5])) ?? [];
    }
    if (args[2] !== undefined && args[2] === args[3] && args[2] !== '-') {
      const id = String(args[2]);
      return this.pendingById.get(id) ?? [[id, 'consumer', 0, 1]];
    }
    return [];
  }

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  /** Runs the consumer release script with this fake's own XPENDING and DELCONSUMER, as Redis would. */
  readonly scripts: unknown[] = [];

  /** Keys, `key\0group`, and `key\0group\0consumer` that another client removed. A script on them replies -1. */
  readonly gone = new Set<string>();

  async eval(script: unknown, ...args: unknown[]): Promise<unknown> {
    this.calls.push(['eval', ...args]);
    this.scripts.push(script);
    if (script === ackDeletedScript) return [];
    const path = args.slice(1, 4).map(String);
    for (let depth = 1; depth <= 3; depth += 1) {
      if (this.gone.has(path.slice(0, depth).join('\0'))) return -1;
    }
    if (script === destroyIdleGroupScript) {
      const [, key, group] = args;
      if (this.#seen(['CONSUMERS', key, group]).length > 0) return 0;
      await this.xgroup('DESTROY', key, group);
      return 1;
    }
    if (script === deleteIdleStreamScript) {
      const [, key, idleMs] = args;
      if (this.#seen(['GROUPS', key]).length > 0) return 0;
      const stream = this.#seen(['STREAM', key]);
      const last = String(stream[stream.indexOf('last-generated-id') + 1]);
      const ms = Number(last.split('-')[0]);
      if (!(ms > 0) || ms > Date.now() - Number(idleMs)) return 0;
      await this.del(key);
      return 1;
    }
    if (script !== releaseConsumerScript) throw new Error('unknown script');
    const [, key, group, consumer] = args;
    const owned = await this.xpending(key, group, '-', '+', 1, consumer);
    if (owned.length > 0) return 0;
    await this.xgroup('DELCONSUMER', key, group, consumer);
    return 1;
  }

  xack(...args: unknown[]): Promise<number> {
    this.calls.push(['xack', ...args]);
    return Promise.resolve(1);
  }

  xclaim(...args: unknown[]): Promise<unknown[]> {
    this.calls.push(['xclaim', ...args]);
    return Promise.resolve([]);
  }

  /** Replies to each `XAUTOCLAIM` as is, such as a Redis 6.2 reply with `nil` for a deleted entry. */
  autoclaimReplies: unknown[][] = [];

  holdAutoclaim = false;

  xautoclaim(...args: unknown[]): Promise<unknown[]> {
    this.calls.push(['xautoclaim', ...args]);
    if (this.holdAutoclaim) return new Promise(() => {});
    if (this.failXautoclaim) return Promise.reject(this.failXautoclaim);
    const reply = this.autoclaimReplies.shift();
    if (reply) return Promise.resolve(reply);
    return Promise.resolve(['0-0', this.autoclaimEntries.splice(0)]);
  }

  scanPages: Array<[string, string[]]> = [['0', []]];
  xinfoReplies = new Map<string, unknown>();
  /** What a script sees when Redis changed after the `XINFO` that `maintain` read. Keyed like `xinfoReplies`. */
  scriptXinfo = new Map<string, unknown>();

  #seen(args: unknown[]): unknown[] {
    const key = args.map(String).join('\0');
    const reply = this.scriptXinfo.get(key) ?? this.xinfoReplies.get(key);
    return Array.isArray(reply) ? reply : [];
  }

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
    if (this.#stuck()) return new Promise(() => {});
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
    if (this.offline) return;
    this.status = 'end';
    this.pending?.reject(new Error('Connection is closed'));
  }

  quit(): Promise<string> {
    this.calls.push(['quit']);
    if (this.#stuck()) return new Promise(() => {});
    this.status = 'end';
    return Promise.resolve('OK');
  }
}

class FakePipeline {
  readonly #redis: FakeRedis;
  readonly #ops: Array<() => Promise<unknown>> = [];

  constructor(redis: FakeRedis) {
    this.#redis = redis;
  }

  xpending(...args: unknown[]): this {
    this.#ops.push(() => this.#redis.xpending(...args));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const replies: Array<[Error | null, unknown]> = [];
    for (const op of this.#ops) {
      try {
        replies.push([null, await op()]);
      } catch (error) {
        replies.push([
          error instanceof Error ? error : new Error(String(error)),
          null,
        ]);
      }
    }
    return replies;
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis, default: FakeRedis }));

const { RedisQueue } = await import('./redis-queue.js');
const { LifecycleError } = await import('./index.js');

function subscribe<T>(
  queue: {
    subscribe: (
      topic: string,
      options: QueueSubscribeOptions<T>,
    ) => Promise<void>;
  },
  topic: string,
  options: Omit<QueueSubscribeOptions<T>, 'maxDeliveries'> & {
    readonly maxDeliveries?: QueueMaxDeliveries;
  },
): Promise<void> {
  const maxDeliveries = options.maxDeliveries ?? 'unlimited';
  return queue.subscribe(topic, {
    consumerGroup: options.consumerGroup,
    handler: options.handler,
    maxDeliveries,
    ...(options.startFrom === undefined
      ? {}
      : { startFrom: options.startFrom }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
}

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

  it('does not age-trim a topic it only subscribes to', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await subscribe(queue, 'orders', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(commands.calls.some((call) => call[0] === 'xtrim')).toBe(false);
    await queue.publish('jobs', { n: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    const trimmed = commands.calls
      .filter((call) => call[0] === 'xtrim')
      .map((call) => call[1]);
    expect(trimmed).toEqual(['hexok:queue:jobs', 'hexok:queue:jobs']);
    await queue.stop();
    vi.useRealTimers();
  });

  it('trim: false sets no timer and sends no XTRIM, and XADD keeps MAXLEN', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      trim: false,
    });
    await queue.start();
    expect(vi.getTimerCount()).toBe(0);
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await queue.publish('jobs', { n: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(commands.calls.some((call) => call[0] === 'xtrim')).toBe(false);
    const xadd = commands.calls.find((call) => call[0] === 'xadd');
    expect(xadd).toContain('MAXLEN');
    await queue.stop();
    vi.useRealTimers();
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
    await subscribe(queue, 'jobs', {
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
    await subscribe(plain, 'jobs', {
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

  it('marks a sensitive entry and parks no payload when its publish fails', async () => {
    const parked: ParkInput[] = [];
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const secret = { code: 'SECRET-4821' };
    await queue.publish('codes', secret, { sensitive: true });
    expect(commands.calls.find((call) => call[0] === 'xadd')).toEqual([
      'xadd',
      'hexok:queue:codes',
      'MAXLEN',
      '~',
      10000,
      '*',
      'payload',
      JSON.stringify(secret),
      'sensitive',
      '1',
    ]);

    commands.failXadd = true;
    const thrown = await queue
      .publish('codes', secret, { sensitive: true })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'ReplyError',
      message: 'xadd failed',
    });
    expect(thrown).not.toHaveProperty('command');
    expect(thrown).not.toHaveProperty('cause');
    expect(textOf(thrown)).not.toContain('SECRET-4821');
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({
      operation: 'publish',
      subject: 'codes',
      payload: { sensitive: true },
    });
    expect(parked[0]?.error).toEqual({
      name: 'ReplyError',
      message: 'queue: XADD failed',
    });
    expect(textOf(parked)).not.toContain('SECRET-4821');
    expect(textOf(logs.calls)).not.toContain('SECRET-4821');

    const plain = await queue
      .publish('codes', secret)
      .catch((error: unknown) => error);
    expect(plain).toHaveProperty('command.name', 'xadd');
    expect(parked[1]?.error).toEqual({
      name: 'ReplyError',
      message: 'xadd failed',
    });
    await queue.stop();
  });

  it('parks a generic error when a sensitive encode fails', async () => {
    const parked: ParkInput[] = [];
    const logs = recordingLogger();
    const invalid = Object.assign(
      new Error('invalid payload: code=SECRET-4821'),
      { code: 'E_INVALID' },
    );
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
      encode: () => {
        throw invalid;
      },
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const thrown = await queue
      .publish('codes', { code: 'SECRET-4821' }, { sensitive: true })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'queue: encode failed',
      code: 'E_INVALID',
    });
    expect(textOf(thrown)).not.toContain('SECRET-4821');
    expect(parked).toHaveLength(1);
    expect(parked[0]?.payload).toEqual({ sensitive: true });
    expect(parked[0]?.error).toEqual({
      name: 'Error',
      message: 'queue: encode failed',
      code: 'E_INVALID',
    });
    expect(textOf(parked)).not.toContain('SECRET-4821');
    expect(textOf(logs.calls)).not.toContain('SECRET-4821');
    await queue.stop();
  });

  it('logs blocking connection errors with the topic', async () => {
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const blocking = FakeRedis.instances[1];
    if (!blocking) throw new Error('missing blocking client');
    const reset = new Error('read ECONNRESET');
    blocking.emit('error', reset);
    expect(logs.calls).toEqual([
      [
        'error',
        reset,
        {
          adapter: 'queue',
          connection: 'blocking',
          topic: 'jobs',
          group: 'billing',
        },
      ],
    ]);
    await queue.stop();
  });

  it('parks and logs nothing from an undecodable sensitive entry', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    await subscribe(queue, 'codes', {
      consumerGroup: 'sms',
      handler: async () => 'ack',
    });
    FakeRedis.instances[1]?.pending?.resolve([
      [
        'hexok:queue:codes',
        [['5-1', ['payload', 'code=SECRET-4821', 'sensitive', '1']]],
      ],
    ]);
    await vi.waitFor(() => {
      expect(parked).toHaveLength(1);
    });
    expect(parked[0]).toMatchObject({
      operation: 'deliver',
      subject: 'codes:5-1',
      payload: { reason: 'decode-failed', sensitive: true },
      error: { name: 'Error', message: 'queue: decode failed' },
    });
    expect(parked[0]?.payload).toEqual({
      reason: 'decode-failed',
      sensitive: true,
    });
    expect(logs.calls).toContainEqual([
      'error',
      new Error('queue: decode failed'),
      { adapter: 'queue', topic: 'codes', group: 'sms', id: '5-1' },
    ]);
    expect(textOf(parked)).not.toContain('SECRET-4821');
    expect(textOf(logs.calls)).not.toContain('SECRET-4821');
    await queue.stop();
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
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => gate,
    });
    await subscribe(queue, 'other', {
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

  it('does not XACK once unsubscribe or stop stops waiting', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 30_000,
      blockMs: 1000,
      stopTimeoutMs: 100,
    });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    await subscribe(queue, 'jobs', {
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
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribing = queue.unsubscribe('jobs', {
      consumerGroup: 'billing',
    });
    await vi.advanceTimersByTimeAsync(100);
    await unsubscribing;
    release('ack');
    await vi.waitFor(() => {
      const commands = FakeRedis.instances[0];
      expect(commands?.calls.some((call) => call[0] === 'xack')).toBe(false);
      expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    });

    const queue2 = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 50,
      stopTimeoutMs: 100,
    });
    await queue2.start();
    let release2: (value: 'ack') => void = () => {};
    await subscribe(queue2, 'jobs', {
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
    await vi.advanceTimersByTimeAsync(0);
    const stopping = queue2.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    release2('ack');
    await vi.advanceTimersByTimeAsync(0);
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
    await subscribe(queue, 'jobs', {
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

    await subscribe(queue, 'other', {
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

  it('keeps a consumer that still owns pending entries on unsubscribe and stop', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    for (const topic of ['jobs', 'other']) {
      await subscribe(queue, topic, {
        consumerGroup: 'billing',
        handler: async () => 'retry',
      });
    }
    const consumers = FakeRedis.instances
      .slice(1)
      .flatMap((client) =>
        client.calls.filter((call) => call[0] === 'xreadgroup'),
      )
      .map((call) => String(call[3]));
    for (const consumer of consumers) {
      commands.pendingByConsumer.set(consumer, [['7-1', consumer, 1000, 1]]);
    }
    await queue.unsubscribe('jobs', { consumerGroup: 'billing' });
    await queue.stop();
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    const checks = commands.calls.filter((call) => call[0] === 'xpending');
    expect(checks).toEqual(
      consumers.map((consumer, index) => [
        'xpending',
        `hexok:queue:${index === 0 ? 'jobs' : 'other'}`,
        'billing',
        '-',
        '+',
        1,
        consumer,
      ]),
    );
  });

  it('maintain defaults to a dry run and does not write', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
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
      retentionMs: 1000,
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

  it('maintain does not trim without retentionMs, whatever the instance retention', async () => {
    const old = `${Date.now() - 60_000}-0`;
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
      groups: 0,
      firstId: old,
    });

    const report = await queue.maintain({ dryRun: false, topics: ['jobs'] });

    expect(report.trimmed).toEqual([]);
    expect(commands.calls.some((call) => call[0] === 'xtrim')).toBe(false);
    await queue.stop();
  });

  it('maintain trims to the retentionMs of the call', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 3,
      lastGeneratedId: old,
      groups: 0,
      firstId: old,
    });

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      retentionMs: 1000,
    });

    expect(report.trimmed).toEqual(['jobs']);
    const xtrim = commands.calls.find((call) => call[0] === 'xtrim');
    expect(xtrim?.slice(1, 4)).toEqual(['hexok:queue:jobs', 'MINID', '~']);
    expect(Number(String(xtrim?.[4]).split('-')[0])).toBeGreaterThanOrEqual(
      now - 1000,
    );
    await queue.stop();
  });

  it('maintain writes only the idle hexok consumer, then the opted-in group and stream', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
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
      retentionMs: 1000,
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
    // The script reads the clock from Redis, so it gets idleMs, not a time from this process.
    expect(
      commands.calls.filter(
        (call) => call[0] === 'eval' && call[2] === 'hexok:queue:empty',
      ),
    ).toEqual([['eval', 1, 'hexok:queue:empty', 1000]]);
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
    await expect(queue.maintain()).rejects.toMatchObject({
      code: 'NotStarted',
    });
  });
});

describe('RedisQueue lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeRedis.instances.length = 0;
    FakeRedis.initialStatus = 'ready';
  });

  it('start waits for the commands client to be ready', async () => {
    FakeRedis.initialStatus = 'connecting';
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    const starting = queue.start();
    const settled = settledFlag(starting);
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled()).toBe(false);
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    expect(commands.calls).toEqual([]);
    commands.becomeReady();
    await starting;
    await expect(queue.publish('jobs', { n: 1 })).resolves.toBe('1-0');
    await queue.stop();
  });

  it('start connects a lazy client', async () => {
    FakeRedis.initialStatus = 'wait';
    const queue = new RedisQueue({
      redis: { host: '127.0.0.1', lazyConnect: true },
    });
    const starting = queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    expect(commands.calls).toEqual([['connect']]);
    commands.becomeReady();
    await starting;
    await queue.stop();
  });

  it('start logs an error before ready and keeps waiting', async () => {
    FakeRedis.initialStatus = 'connecting';
    const logged: unknown[] = [];
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: { ...silentLogger, error: (message) => logged.push(message) },
    });
    const starting = queue.start();
    const settled = settledFlag(starting);
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    commands.emit('error', refused);
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled()).toBe(false);
    expect(logged).toEqual([refused]);
    commands.becomeReady();
    await starting;
    const later = new Error('read ECONNRESET');
    commands.emit('error', later);
    expect(logged).toEqual([refused, later]);
    await queue.stop();
  });

  it('stop rejects a pending start and closes its client', async () => {
    FakeRedis.initialStatus = 'connecting';
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    const starting = queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await queue.stop();
    await expect(starting).rejects.toMatchObject({ code: 'Stopped' });
    expect(commands.calls).toContainEqual(['disconnect']);
    expect(commands.listenerCount('ready')).toBe(0);
  });

  it('start rejects on end and can start again', async () => {
    FakeRedis.initialStatus = 'connecting';
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    const starting = queue.start();
    const first = FakeRedis.instances[0];
    if (!first) throw new Error('missing commands client');
    first.emit('end');
    await expect(starting).rejects.toMatchObject({ code: 'EndedBeforeReady' });
    expect(first.listenerCount('end')).toBe(0);
    await expect(queue.publish('jobs', 1)).rejects.toMatchObject({
      code: 'NotStarted',
    });

    FakeRedis.initialStatus = 'ready';
    await queue.start();
    expect(FakeRedis.instances).toHaveLength(2);
    expect(FakeRedis.instances[1]?.listenerCount('error')).toBe(1);
    await expect(queue.publish('jobs', 1)).resolves.toBe('1-0');
    await queue.stop();
  });

  it('stop disconnects an unready commands client without DELCONSUMER', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.goOffline();
    await expect(promptly(queue.stop())).resolves.toBe('settled');
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    expect(commands.calls).toContainEqual(['disconnect']);
    expect(commands.calls).not.toContainEqual(['quit']);
  });

  it('stop does not wait on a blocking read that never settles', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const blocking = FakeRedis.instances[1];
    if (!blocking) throw new Error('missing blocking client');
    blocking.goOffline();
    await expect(promptly(queue.stop())).resolves.toBe('settled');
    expect(blocking.calls).toContainEqual(['disconnect']);
    expect(blocking.calls).not.toContainEqual(['quit']);
  });

  it('stop closes the commands client when its commands never settle', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
      stopTimeoutMs: 1000,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.stalled = true;
    const stopped = settledFlag(queue.stop());
    await vi.advanceTimersByTimeAsync(1000);
    expect(stopped()).toBe(true);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(1);
    expect(commands.calls).toContainEqual(['disconnect']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('subscribe rejects when stop runs while it creates the group', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.holdCreate = true;
    const subscribing = subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    subscribing.catch(() => undefined);
    const stopping = queue.stop();
    commands.heldCreate?.resolve(undefined);
    await stopping;
    await expect(subscribing).rejects.toMatchObject({ code: 'Stopped' });
    expect(FakeRedis.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the read loop logs a failed group create and backs off', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    const blocking = FakeRedis.instances[1];
    if (!commands || !blocking) throw new Error('missing clients');
    const wrongType = new Error('WRONGTYPE Operation against a key');
    commands.failCreate = wrongType;
    blocking.pending?.reject(new Error('NOGROUP No such key'));
    await vi.advanceTimersByTimeAsync(0);
    expect(logs.calls).toEqual([
      [
        'error',
        wrongType,
        {
          adapter: 'queue',
          connection: 'commands',
          topic: 'jobs',
          group: 'billing',
        },
      ],
    ]);
    const reads = () =>
      blocking.calls.filter((call) => call[0] === 'xreadgroup');
    expect(reads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads()).toHaveLength(2);
    await queue.stop();
  });

  it('recover logs a failed group create', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
      logger: logs.sink,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const wrongType = new Error('WRONGTYPE Operation against a key');
    commands.failXautoclaim = new Error('NOGROUP No such key');
    commands.failCreate = wrongType;
    await vi.advanceTimersByTimeAsync(500);
    expect(logs.calls).toEqual([
      [
        'error',
        wrongType,
        {
          adapter: 'queue',
          connection: 'commands',
          topic: 'jobs',
          group: 'billing',
        },
      ],
    ]);
    await queue.stop();
  });

  it('stop waits for a handler that XAUTOCLAIM dispatched', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.autoclaimEntries = [['3-1', ['payload', '{}']]];
    let release: (value: 'ack') => void = () => {};
    let started = false;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () => {
        started = true;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toBe(true);
    const stopped = settledFlag(queue.stop());
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped()).toBe(false);
    release('ack');
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unsubscribe leaves a newer subscription for the same group alone', async () => {
    // stop() waits for the held release until stopTimeoutMs.
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 100,
    });
    const options = {
      consumerGroup: 'billing',
      handler: async () => 'ack' as const,
    };
    await queue.start();
    await subscribe(queue, 'jobs', options);
    const first = FakeRedis.instances[0];
    if (!first) throw new Error('missing commands client');
    first.holdXpending = true;
    const unsubscribing = queue.unsubscribe('jobs', {
      consumerGroup: 'billing',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await queue.stop();
    await queue.start();
    await subscribe(queue, 'jobs', options);
    first.heldXpending?.resolve(undefined);
    await unsubscribing;
    await expect(subscribe(queue, 'jobs', options)).rejects.toThrow(
      'queue: already subscribed to jobs group billing',
    );
    await queue.stop();
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
    await subscribe(queue, 'jobs', {
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
    await subscribe(queue, 'jobs', {
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

describe('RedisQueue reliability', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeRedis.instances.length = 0;
    FakeRedis.initialStatus = 'ready';
  });

  it('recovery skips an entry Redis 6.2 returns as nil, acks the deleted ids, and keeps running', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.autoclaimReplies = [
      ['0-0', [null, ['3-1', ['payload', '{"n":1}']]]],
      ['0-0', [null, ['3-2', ['payload', '{"n":2}']]]],
    ];
    const handled: string[] = [];
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async (message) => {
        handled.push(message.id);
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(handled).toEqual(['3-1', '3-2']);
    expect(
      commands.scripts.filter((script) => script === ackDeletedScript),
    ).toHaveLength(2);
    expect(logs.calls).toEqual([]);
    await queue.stop();
  });

  it('the heartbeat claims every entry of a read batch while the first is handled', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 300,
    });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    FakeRedis.instances[1]?.pending?.resolve([
      [
        'hexok:queue:jobs',
        [
          ['4-1', ['payload', '{}']],
          ['4-2', ['payload', '{}']],
          ['4-3', ['payload', '{}']],
        ],
      ],
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const commands = FakeRedis.instances[0];
    const claims = commands?.calls.filter((call) => call[0] === 'xclaim');
    expect(claims?.[0]?.slice(5)).toEqual(['4-1', '4-2', '4-3', 'JUSTID']);
    release('ack');
    await queue.stop();
  });

  it('stop acks a handler that finishes while it waits, then removes the consumer', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const stopped = settledFlag(queue.stop());
    await vi.advanceTimersByTimeAsync(50);
    expect(stopped()).toBe(false);
    release('ack');
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped()).toBe(true);
    const commands = FakeRedis.instances[0];
    expect(commands?.calls.filter((call) => call[0] === 'xack')).toEqual([
      ['xack', 'hexok:queue:jobs', 'billing', '4-1'],
    ]);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(1);
  });

  it('unsubscribe acks a handler that finishes while it waits', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribing = queue.unsubscribe('jobs', {
      consumerGroup: 'billing',
    });
    release('ack');
    await unsubscribing;
    const commands = FakeRedis.instances[0];
    expect(commands?.calls.filter((call) => call[0] === 'xack')).toEqual([
      ['xack', 'hexok:queue:jobs', 'billing', '4-1'],
    ]);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(1);
    await queue.stop();
  });

  it('a handler that unsubscribes its own subscription is not waited for', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 3000,
    });
    await queue.start();
    let finished = false;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => {
        await queue.unsubscribe('jobs', { consumerGroup: 'billing' });
        finished = true;
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    const commands = FakeRedis.instances[0];
    expect(commands?.calls.some((call) => call[0] === 'xack')).toBe(false);
    await queue.stop();
  });

  it('a handler that calls stop is not waited for', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 3000,
    });
    await queue.start();
    let finished = false;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => {
        await queue.stop();
        finished = true;
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(queue.state).toBe('stopped');
  });

  it('parks a publish cut short by stop with outcome unknown', async () => {
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
      stopTimeoutMs: 500,
      quarantine,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.failXadd = true;
    await queue.publish('jobs', { n: 0 }).catch(() => undefined);
    commands.failXadd = false;
    commands.stalled = true;
    const publishing = queue.publish('jobs', { n: 1 });
    publishing.catch(() => undefined);
    const stopping = queue.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    await expect(publishing).rejects.toMatchObject({
      code: 'StoppedBeforeReply',
    });
    expect(parked.map((item) => item.context)).toEqual([
      { adapter: 'redis' },
      { adapter: 'redis', outcome: 'unknown' },
    ]);
    expect(parked[1]).toMatchObject({
      operation: 'publish',
      payload: { n: 1 },
      error: { code: 'StoppedBeforeReply' },
    });
  });

  it('stopTimeoutMs defaults to 10000 whatever visibilityMs is', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 60_000,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.stalled = true;
    const stopped = settledFlag(queue.stop());
    await vi.advanceTimersByTimeAsync(9999);
    expect(stopped()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped()).toBe(true);
  });

  it('logs a background command that stop cut short at warn', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
      logger: logs.sink,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.stalled = true;
    const stopping = queue.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    expect(logs.calls).toEqual([
      [
        'warn',
        'queue: stop() stopped waiting before Redis replied to the consumer release. Redis may or may not have run it.',
        {
          adapter: 'queue',
          connection: 'commands',
          topic: 'jobs',
          group: 'billing',
          code: 'StoppedBeforeReply',
        },
      ],
    ]);
  });

  it('stop armed on a timer inside a handler still waits for and acks a later handler', async () => {
    // Real timers: a fake timer runs its callback outside the handler's async context.
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    let release: (value: 'ack') => void = () => {};
    let stopping: Promise<void> | undefined;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async (message) => {
        if (message.id === '4-1') {
          setTimeout(() => {
            stopping = queue.stop();
          }, 50);
          return 'ack';
        }
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      [
        'hexok:queue:jobs',
        [
          ['4-1', ['payload', '{}']],
          ['4-2', ['payload', '{}']],
        ],
      ],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!stopping) throw new Error('stop was not called');
    const stopped = settledFlag(stopping);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped()).toBe(false);
    release('ack');
    await stopping;
    const commands = FakeRedis.instances[0];
    expect(commands?.calls.filter((call) => call[0] === 'xack')).toEqual([
      ['xack', 'hexok:queue:jobs', 'billing', '4-1'],
      ['xack', 'hexok:queue:jobs', 'billing', '4-2'],
    ]);
  });

  it('unsubscribe warns when it stops waiting for a handler and leaves the consumer', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
      logger: logs.sink,
    });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () => new Promise(() => {}),
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribing = queue.unsubscribe('jobs', {
      consumerGroup: 'billing',
    });
    await vi.advanceTimersByTimeAsync(500);
    await unsubscribing;
    expect(logs.calls).toEqual([
      [
        'warn',
        'queue: unsubscribe() stopped waiting for handlers after 500ms. The consumer is left for maintain().',
        {
          adapter: 'queue',
          connection: 'commands',
          topic: 'jobs',
          group: 'billing',
        },
      ],
    ]);
    await queue.stop();
  });

  it('a recovery tick is skipped while the previous one runs', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
      stopTimeoutMs: 100,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.holdAutoclaim = true;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      commands.calls.filter((call) => call[0] === 'xautoclaim'),
    ).toHaveLength(1);
    const stopping = queue.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
  });

  it('recovery accepts the deleted ids Redis 7 returns as a third element', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      visibilityMs: 1000,
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.autoclaimReplies = [
      ['0-0', [['3-1', ['payload', '{"n":1}']]], ['2-9']],
    ];
    const handled: string[] = [];
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async (message) => {
        handled.push(message.id);
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(handled).toEqual(['3-1']);
    expect(commands.scripts).not.toContain(ackDeletedScript);
    expect(logs.calls).toEqual([]);
    await queue.stop();
  });

  it('state follows start and stop, and a failed start returns to idle', async () => {
    FakeRedis.initialStatus = 'connecting';
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    expect(queue.state).toBe('idle');
    const starting = queue.start();
    expect(queue.state).toBe('starting');
    FakeRedis.instances[0]?.becomeReady();
    await starting;
    expect(queue.state).toBe('ready');
    const stopping = queue.stop();
    expect(queue.state).toBe('stopping');
    await stopping;
    expect(queue.state).toBe('stopped');

    const failed = queue.start();
    FakeRedis.instances[1]?.emit('end');
    await expect(failed).rejects.toMatchObject({ code: 'EndedBeforeReady' });
    expect(queue.state).toBe('idle');
  });

  it('a call while start is pending says start has not finished', async () => {
    FakeRedis.initialStatus = 'connecting';
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    const starting = queue.start();
    const publishing = queue.publish('jobs', { n: 1 });
    await expect(publishing).rejects.toBeInstanceOf(LifecycleError);
    await expect(publishing).rejects.toMatchObject({
      code: 'Starting',
      message: expect.stringContaining('start() has not finished'),
    });
    await expect(queue.maintain()).rejects.toMatchObject({ code: 'Starting' });
    FakeRedis.instances[0]?.becomeReady();
    await starting;
    await queue.stop();
  });

  it('subscribe rejects with StoppedBeforeReply when its group create never settles', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.holdCreate = true;
    const subscribing = subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    subscribing.catch(() => undefined);
    const stopped = settledFlag(queue.stop());
    await vi.advanceTimersByTimeAsync(500);
    expect(stopped()).toBe(true);
    await expect(subscribing).rejects.toMatchObject({
      code: 'StoppedBeforeReply',
    });
    expect(FakeRedis.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unsubscribe resolves within stopTimeoutMs when Redis stops answering the release', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
      logger: logs.sink,
    });
    await queue.start();
    // The age trim interval belongs to the started queue.
    const timers = vi.getTimerCount();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.stalled = true;
    const unsubscribed = settledFlag(
      queue.unsubscribe('jobs', { consumerGroup: 'billing' }),
    );
    await vi.advanceTimersByTimeAsync(499);
    expect(unsubscribed()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(unsubscribed()).toBe(true);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(1);
    expect(logs.calls).toEqual([
      [
        'error',
        expect.objectContaining({
          message: expect.stringContaining('stopped waiting for Redis'),
        }),
        {
          adapter: 'queue',
          connection: 'commands',
          topic: 'jobs',
          group: 'billing',
        },
      ],
    ]);
    expect(vi.getTimerCount()).toBe(timers);
    commands.stalled = false;
    await queue.stop();
  });

  it('unsubscribe resolves within stopTimeoutMs while a handler never returns, and keeps the consumer', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
    });
    await queue.start();
    const timers = vi.getTimerCount();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: () => new Promise(() => {}),
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['4-1', ['payload', '{}']]]],
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribed = settledFlag(
      queue.unsubscribe('jobs', { consumerGroup: 'billing' }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(unsubscribed()).toBe(true);
    const commands = FakeRedis.instances[0];
    expect(commands?.calls.some((call) => call[0] === 'eval')).toBe(false);
    expect(vi.getTimerCount()).toBe(timers);
    await queue.stop();
  });

  it('unsubscribe ends a read on a reconnecting blocking client', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async () => 'ack',
    });
    const blocking = FakeRedis.instances[1];
    if (!blocking) throw new Error('missing blocking client');
    blocking.pending?.resolve(null);
    blocking.goOffline();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      promptly(queue.unsubscribe('jobs', { consumerGroup: 'billing' })),
    ).resolves.toBe('settled');
    expect(callsOf(FakeRedis.instances[0], 'DELCONSUMER')).toHaveLength(1);
    await queue.stop();
  });

  it('the release script reply means removed, kept, gone, or a failure', async () => {
    const replies: unknown[] = [1, 0, -1, 'OK'];
    const commands = {
      eval: async () => replies.shift(),
    } as unknown as import('ioredis').Redis;
    await expect(releaseConsumer(commands, 'k', 'g', 'c')).resolves.toBe(
      'removed',
    );
    await expect(releaseConsumer(commands, 'k', 'g', 'c')).resolves.toBe(
      'kept',
    );
    await expect(releaseConsumer(commands, 'k', 'g', 'c')).resolves.toBe(
      'gone',
    );
    await expect(releaseConsumer(commands, 'k', 'g', 'c')).rejects.toThrow(
      'queue: the consumer release script replied unexpectedly',
    );
  });

  it('maintain keeps and does not report a consumer that took a pending entry after XINFO', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    scriptStream(commands, 'hexok:queue:jobs', {
      length: 1,
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
    commands.pendingByConsumer.set('hexok:1:abc', [
      ['7-1', 'hexok:1:abc', 1, 1],
    ]);

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      idleConsumerMs: 1000,
      dropIdleGroups: { idleMs: 1000 },
      dropIdleStreams: { idleMs: 1000 },
    });

    expect(commands.calls).toContainEqual([
      'eval',
      1,
      'hexok:queue:jobs',
      'billing',
      'hexok:1:abc',
    ]);
    expect(callsOf(commands, 'DELCONSUMER')).toHaveLength(0);
    expect(report.consumersRemoved).toEqual([]);
    expect(report.groupsDestroyed).toEqual([]);
    expect(report.streamsDeleted).toEqual([]);
    expect(callsOf(commands, 'DESTROY')).toHaveLength(0);
    await queue.stop();
  });

  it('maintain keeps and does not report a group that gained a consumer after XINFO', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const key = 'hexok:queue:jobs';
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
      lastDeliveredId: old,
    });
    commands.scriptXinfo.set(['CONSUMERS', key, 'billing'].join('\0'), [
      ['name', 'hexok:2:new', 'pending', 0, 'idle', 0],
    ]);

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      dropIdleGroups: { idleMs: 1000 },
      dropIdleStreams: { idleMs: 1000 },
    });

    expect(callsOf(commands, 'DESTROY')).toHaveLength(0);
    expect(commands.calls.some((call) => call[0] === 'del')).toBe(false);
    expect(report.groupsDestroyed).toEqual([]);
    expect(report.streamsDeleted).toEqual([]);
    await queue.stop();
  });

  it('maintain keeps and does not report a stream that gained a group after XINFO', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const key = 'hexok:queue:jobs';
    scriptStream(commands, key, {
      length: 0,
      lastGeneratedId: old,
      groups: 0,
    });
    commands.scriptXinfo.set(['GROUPS', key].join('\0'), [
      ['name', 'mail', 'consumers', 0, 'pending', 0],
    ]);

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      dropIdleStreams: { idleMs: 1000 },
    });

    expect(commands.calls.some((call) => call[0] === 'del')).toBe(false);
    expect(report.streamsDeleted).toEqual([]);
    await queue.stop();
  });

  it('maintain does not report or log what another run removed first', async () => {
    const now = Date.now();
    const old = `${now - 60_000}-0`;
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const key = 'hexok:queue:jobs';
    scriptStream(commands, key, {
      length: 1,
      lastGeneratedId: old,
      groups: 1,
      firstId: old,
    });
    scriptGroup(commands, key, {
      name: 'billing',
      consumers: 1,
      pending: 0,
      lastDeliveredId: old,
    });
    scriptConsumer(commands, key, 'billing', {
      name: 'hexok:1:abc',
      pending: 0,
      idle: 50_000,
    });
    commands.gone.add(key);

    const report = await queue.maintain({
      dryRun: false,
      topics: ['jobs'],
      idleConsumerMs: 1000,
      dropIdleGroups: { idleMs: 1000 },
      dropIdleStreams: { idleMs: 1000 },
    });

    expect(commands.scripts).toEqual([
      releaseConsumerScript,
      destroyIdleGroupScript,
      deleteIdleStreamScript,
    ]);
    expect(report.consumersRemoved).toEqual([]);
    expect(report.groupsDestroyed).toEqual([]);
    expect(report.streamsDeleted).toEqual([]);
    expect(logs.calls).toEqual([]);
    await queue.stop();
  });

  it('maintain rejects with StoppedBeforeReply when stop cuts it short, and logs nothing', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      stopTimeoutMs: 500,
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.stalled = true;
    const maintaining = queue.maintain({ topics: ['jobs', 'other'] });
    maintaining.catch(() => undefined);
    const stopping = queue.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    await expect(maintaining).rejects.toMatchObject({
      code: 'StoppedBeforeReply',
    });
    expect(commands.calls.filter((call) => call[0] === 'xinfo')).toHaveLength(
      1,
    );
    expect(logs.calls).toEqual([]);
  });

  it('rejects a bad maxDeliveries before creating the group', async () => {
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    for (const maxDeliveries of [0, -1, 1.5]) {
      await expect(
        queue.subscribe('jobs', {
          consumerGroup: 'billing',
          maxDeliveries,
          handler: async () => 'ack',
        }),
      ).rejects.toThrow(
        'queue: maxDeliveries must be a positive integer or "unlimited"',
      );
    }
    expect(commands.calls.some((call) => call[0] === 'xgroup')).toBe(false);
    await queue.stop();
  });

  it('acks and parks a throw on the last delivery', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    const seen: number[] = [];
    const thrown = Object.assign(new Error('smtp down'), {
      code: 'Unavailable',
      catalog: 'email',
    });
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 1,
      handler: async (message) => {
        seen.push(message.deliveries);
        throw thrown;
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-1', ['payload', '{"n":1}']]]],
    ]);
    await vi.waitFor(() => {
      expect(parked).toHaveLength(1);
    });
    expect(seen).toEqual([1]);
    expect(parked[0]).toMatchObject({
      source: 'queue',
      operation: 'deliver',
      subject: 'jobs:9-1',
      attempts: 1,
      payload: { reason: 'deliveries-exhausted', payload: { n: 1 } },
      error: {
        name: 'Error',
        message: 'queue: deliveries exhausted',
        code: 'Unavailable',
        catalog: 'email',
      },
    });
    expect(textOf(parked)).not.toContain('smtp down');
    expect(commands.calls.filter((call) => call[0] === 'xack')).toEqual([
      ['xack', 'hexok:queue:jobs', 'billing', '9-1'],
    ]);
    expect(logs.calls).toContainEqual([
      'error',
      thrown,
      { adapter: 'queue', topic: 'jobs', group: 'billing', id: '9-1' },
    ]);
    expect(logs.calls).toContainEqual([
      'error',
      new Error('queue: deliveries exhausted'),
      {
        adapter: 'queue',
        topic: 'jobs',
        group: 'billing',
        id: '9-1',
        deliveries: 1,
      },
    ]);
    await queue.stop();
  });

  it('leaves a retry pending while deliveries remain', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 2,
      handler: async () => 'retry',
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-2', ['payload', '{}']]]],
    ]);
    await vi.waitFor(() => {
      expect(commands.calls.some((call) => call[0] === 'xpending')).toBe(true);
    });
    expect(commands.calls.some((call) => call[0] === 'xack')).toBe(false);
    expect(parked).toEqual([]);
    await queue.stop();
  });

  it('does not call the handler when the count is already past the ceiling', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.pendingById.set('9-3', [['9-3', 'consumer', 0, 2]]);
    let calls = 0;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 1,
      handler: async () => {
        calls += 1;
        return 'ack';
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-3', ['payload', '{"n":3}']]]],
    ]);
    await vi.waitFor(() => {
      expect(parked).toHaveLength(1);
    });
    expect(calls).toBe(0);
    expect(parked[0]).toMatchObject({
      attempts: 2,
      error: { name: 'Error', message: 'queue: deliveries exhausted' },
    });
    expect(commands.calls.filter((call) => call[0] === 'xack')).toEqual([
      ['xack', 'hexok:queue:jobs', 'billing', '9-3'],
    ]);
    expect(logs.calls).toContainEqual([
      'error',
      new Error('queue: deliveries exhausted'),
      {
        adapter: 'queue',
        topic: 'jobs',
        group: 'billing',
        id: '9-3',
        deliveries: 2,
      },
    ]);
    await queue.stop();
  });

  it('acks ack, void, and drop on the last delivery without parking', async () => {
    for (const returned of ['ack', 'drop', undefined] as const) {
      vi.useFakeTimers();
      const parked: ParkInput[] = [];
      const queue = new RedisQueue({
        redis: 'redis://127.0.0.1:6379',
        quarantine: {
          async park(input: ParkInput) {
            parked.push(input);
            return { id: 'q1' };
          },
        },
      });
      await queue.start();
      const commands = FakeRedis.instances[0];
      if (!commands) throw new Error('missing commands client');
      commands.pendingById.set('9-4', [['9-4', 'consumer', 0, 2]]);
      await subscribe(queue, 'jobs', {
        consumerGroup: 'billing',
        maxDeliveries: 2,
        handler: async () => returned,
      });
      FakeRedis.instances[1]?.pending?.resolve([
        ['hexok:queue:jobs', [['9-4', ['payload', '{}']]]],
      ]);
      await vi.waitFor(() => {
        expect(commands.calls.some((call) => call[0] === 'xack')).toBe(true);
      });
      expect(parked).toEqual([]);
      await queue.stop();
      FakeRedis.instances.length = 0;
    }
  });

  it('drops a throw when onError is drop, even at the ceiling', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 1,
      onError: 'drop',
      handler: async () => {
        throw new Error('nope');
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-5', ['payload', '{}']]]],
    ]);
    await vi.waitFor(() => {
      expect(commands.calls.some((call) => call[0] === 'xack')).toBe(true);
    });
    expect(parked).toEqual([]);
    await queue.stop();
  });

  it('keeps retrying an unlimited subscription past a high count', async () => {
    vi.useFakeTimers();
    const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.pendingById.set('9-6', [['9-6', 'consumer', 0, 40]]);
    const seen: number[] = [];
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      handler: async (message) => {
        seen.push(message.deliveries);
        return 'retry';
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-6', ['payload', '{}']]]],
    ]);
    await vi.waitFor(() => {
      expect(seen).toEqual([40]);
    });
    expect(commands.calls.some((call) => call[0] === 'xack')).toBe(false);
    await queue.stop();
  });

  it('parks a sensitive give-up without the payload', async () => {
    vi.useFakeTimers();
    const parked: ParkInput[] = [];
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    await queue.start();
    await subscribe(queue, 'codes', {
      consumerGroup: 'sms',
      maxDeliveries: 1,
      handler: async () => {
        throw new Error('nope');
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      [
        'hexok:queue:codes',
        [['9-7', ['payload', '{"code":"SECRET"}', 'sensitive', '1']]],
      ],
    ]);
    await vi.waitFor(() => {
      expect(parked).toHaveLength(1);
    });
    expect(parked[0]?.payload).toEqual({
      reason: 'deliveries-exhausted',
      sensitive: true,
    });
    expect(textOf(parked)).not.toContain('SECRET');
    await queue.stop();
  });

  it('acks a give-up when no sink is configured and still logs it', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 1,
      handler: async () => 'retry',
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-8', ['payload', '{}']]]],
    ]);
    await vi.waitFor(() => {
      expect(commands.calls.some((call) => call[0] === 'xack')).toBe(true);
    });
    expect(logs.calls).toContainEqual([
      'error',
      new Error('queue: deliveries exhausted'),
      {
        adapter: 'queue',
        topic: 'jobs',
        group: 'billing',
        id: '9-8',
        deliveries: 1,
      },
    ]);
    await queue.stop();
  });

  it('does not run or ack an entry whose delivery count is missing', async () => {
    vi.useFakeTimers();
    const logs = recordingLogger();
    const queue = new RedisQueue({
      redis: 'redis://127.0.0.1:6379',
      logger: logs.sink,
    });
    await queue.start();
    const commands = FakeRedis.instances[0];
    if (!commands) throw new Error('missing commands client');
    commands.pendingById.set('9-9', []);
    let calls = 0;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 5,
      handler: async () => {
        calls += 1;
        return 'ack';
      },
    });
    FakeRedis.instances[1]?.pending?.resolve([
      ['hexok:queue:jobs', [['9-9', ['payload', '{}']]]],
    ]);
    await vi.waitFor(() => {
      expect(logs.calls).toContainEqual([
        'error',
        new Error('queue: delivery count missing'),
        { adapter: 'queue', topic: 'jobs', group: 'billing', id: '9-9' },
      ]);
    });
    expect(calls).toBe(0);
    expect(commands.calls.some((call) => call[0] === 'xack')).toBe(false);
    await queue.stop();
  });
});

function recordingLogger() {
  const calls: unknown[][] = [];
  const sink = {
    debug: (...args: unknown[]) => calls.push(['debug', ...args]),
    info: (...args: unknown[]) => calls.push(['info', ...args]),
    warn: (...args: unknown[]) => calls.push(['warn', ...args]),
    error: (...args: unknown[]) => calls.push(['error', ...args]),
  };
  return { calls, sink };
}

/** `JSON.stringify(new Error())` is `{}`, so errors expand to their fields, message, and stack. */
function textOf(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Error
      ? {
          ...item,
          name: item.name,
          message: item.message,
          stack: item.stack,
          cause: item.cause,
        }
      : item,
  );
}

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Resolves `'settled'` if `promise` settles within 200ms of real time, else `'pending'`. */
function promptly(promise: Promise<unknown>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('pending'), 200);
  });
  return Promise.race([promise.then(() => 'settled'), pending]).finally(() =>
    clearTimeout(timer),
  );
}

function settledFlag(promise: Promise<unknown>): () => boolean {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

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
