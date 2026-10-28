import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  LifecycleError,
  type LifecycleState,
  type LogSink,
  openRedis,
  RedisLifecycle,
  sleep,
} from '@hexok/ioredis-lifecycle';
import {
  dispositionOf,
  Queue,
  type QueueDisposition,
  type QueueHandler,
  type QueuePublishOptions,
  type QueueStartFrom,
  type QueueSubscribeOptions,
} from '@hexok/queue';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { decodeJson, encodeJson } from './codec.js';
import {
  maintainStreams,
  type RedisQueueMaintainOptions,
  type RedisQueueMaintainReport,
  type RedisQueueMaintainSkipReason,
  type RedisQueueStuckReason,
} from './maintain.js';
import { courtesyPark, type ParkSink, parkedError } from './park.js';
import { ackDeleted, releaseConsumer } from './scripts.js';

export type {
  RedisQueueMaintainOptions,
  RedisQueueMaintainReport,
  RedisQueueMaintainSkipReason,
  RedisQueueStuckReason,
};

export interface RedisQueueConfig {
  readonly redis: string | RedisOptions;
  readonly keyPrefix?: string;
  readonly visibilityMs?: number;
  readonly batch?: number;
  readonly blockMs?: number;
  readonly maxLen?: number;
  readonly retentionMs?: number;
  /**
   * How long `stop()` and `unsubscribe()` wait for handlers, consumer release, and `QUIT`. Default `visibilityMs`.
   * After `visibilityMs`, another consumer reclaims an unacked entry, so waiting longer gains nothing.
   */
  readonly stopTimeoutMs?: number;
  /** Rejects `start()` with `StartTimeout` when Redis is not ready in time. Unset, `start()` waits for Redis. */
  readonly startTimeoutMs?: number;
  readonly encode?: (payload: unknown) => string;
  readonly decode?: (raw: string) => unknown;
  readonly logger?: LogSink;
  readonly quarantine?: ParkSink;
}

type Clients = { readonly commands: Redis };

/** Runs one command on the commands client through the lifecycle. */
type CommandRun = <T>(command: (clients: Clients) => Promise<T>) => Promise<T>;

interface Subscription {
  readonly topic: string;
  readonly group: string;
  readonly key: string;
  readonly consumer: string;
  readonly startId: string;
  readonly onError: QueueDisposition;
  readonly handler: QueueHandler<unknown>;
  /** Aborts on `unsubscribe` or `stop()`. It ends the current read or backoff. */
  readonly abort: AbortController;
  /**
   * How a settled handler runs `XACK`. `unsubscribe` and `stop()` swap in their own run while they wait for handlers,
   * and clear it when they stop waiting, so a handler that returns later does not `XACK`.
   */
  ack: CommandRun | undefined;
  readonly inflight: Set<string>;
  readonly blocking: Redis;
  heartbeat: ReturnType<typeof setInterval> | undefined;
  recovery: ReturnType<typeof setInterval> | undefined;
  /** `XAUTOCLAIM` runs, which can dispatch handlers. */
  readonly recovering: Set<Promise<void>>;
  /** Resolves when the read loop ends, after its last handler. */
  readonly done: Promise<void>;
  readonly finish: () => void;
}

type StreamEntry = [string, string[]];
type StreamRead = [string, StreamEntry[]];

const ADAPTER = 'queue';

const noopSink: LogSink = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function startIdOf(startFrom: QueueStartFrom | undefined): string {
  if (startFrom === undefined || startFrom === 'earliest') return '0';
  if (startFrom === 'now') return '$';
  if ('afterTimestampMs' in startFrom) return `${startFrom.afterTimestampMs}-0`;
  return startFrom.afterStreamId;
}

function isNoGroup(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOGROUP');
}

function isBusyGroup(error: unknown): boolean {
  return error instanceof Error && error.message.includes('BUSYGROUP');
}

/** Keeps `name` and a string `code`. Drops `command`, `cause`, and any other field that can carry the payload. */
function scrubbed(error: unknown, message: string): Error {
  const clean = new Error(message);
  if (!(error instanceof Error)) return clean;
  clean.name = error.name;
  const code: unknown = (error as { code?: unknown }).code;
  if (typeof code === 'string') return Object.assign(clean, { code });
  return clean;
}

function isStreamEntry(entry: unknown): entry is StreamEntry {
  return (
    Array.isArray(entry) &&
    typeof entry[0] === 'string' &&
    Array.isArray(entry[1])
  );
}

function fieldOf(fields: string[], name: string): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === name) return fields[i + 1];
  }
  return undefined;
}

async function createGroup(
  commands: Redis,
  key: string,
  group: string,
  startId: string,
): Promise<void> {
  try {
    await commands.xgroup('CREATE', key, group, startId, 'MKSTREAM');
  } catch (error) {
    if (!isBusyGroup(error)) throw error;
  }
}

/** The subscription's read loop and any handlers `XAUTOCLAIM` dispatched. */
function handlersOf(sub: Subscription): Promise<unknown> {
  return Promise.all([sub.done, ...sub.recovering]);
}

/** Resolves when `promise` settles or `signal` aborts, whichever is first. It removes its listener either way. */
function settledOrAborted(
  promise: Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    promise.then(done, done);
  });
}

export class RedisQueue extends Adapter(Queue) {
  readonly #redis: string | RedisOptions;
  readonly #keyPrefix: string;
  readonly #visibilityMs: number;
  readonly #stopTimeoutMs: number;
  readonly #batch: number;
  readonly #blockMs: number;
  readonly #maxLen: number;
  readonly #retentionMs: number;
  readonly #encode: (payload: unknown) => string;
  readonly #decode: (raw: string) => unknown;
  readonly #logger: LogSink;
  readonly #quarantine: ParkSink | undefined;
  readonly #lifecycle: RedisLifecycle<Clients>;
  #trimTimer: ReturnType<typeof setInterval> | undefined;
  readonly #topics = new Set<string>();
  readonly #subs = new Map<string, Subscription>();
  /**
   * The subscription whose handler is running. A handler that calls `unsubscribe` on its own subscription, or `stop()`,
   * would otherwise wait for itself until `stopTimeoutMs`.
   */
  readonly #handling = new AsyncLocalStorage<Subscription>();

  constructor(config: RedisQueueConfig) {
    super();
    this.#redis = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:queue:';
    this.#visibilityMs = config.visibilityMs ?? 30_000;
    this.#stopTimeoutMs = config.stopTimeoutMs ?? this.#visibilityMs;
    this.#batch = config.batch ?? 10;
    this.#blockMs = config.blockMs ?? 1000;
    this.#maxLen = config.maxLen ?? 10_000;
    this.#retentionMs = config.retentionMs ?? 86_400_000;
    this.#encode = config.encode ?? encodeJson;
    this.#decode = config.decode ?? decodeJson;
    this.#logger = config.logger ?? noopSink;
    this.#quarantine = config.quarantine;
    this.#lifecycle = new RedisLifecycle({
      adapter: ADAPTER,
      stopTimeoutMs: this.#stopTimeoutMs,
      startTimeoutMs: config.startTimeoutMs,
      logger: this.#logger,
    });
  }

  /** The lifecycle state. It suits a readiness or health check. */
  get state(): LifecycleState {
    return this.#lifecycle.state;
  }

  override start(): Promise<void> {
    return this.#lifecycle.start(
      () => ({ commands: openRedis(this.#redis) }),
      () => {
        this.#trimTimer = setInterval(() => {
          void this.#trimAll();
        }, 60_000);
      },
    );
  }

  async publish(
    topic: string,
    payload: unknown,
    options: QueuePublishOptions = {},
  ): Promise<string> {
    // A state error comes before encoding, so it is never parked.
    this.#lifecycle.assertReady('publish');
    const sensitive = options.sensitive === true;
    let encoded: string;
    try {
      encoded = this.#encode(payload);
    } catch (error) {
      await this.#parkPublish(topic, payload, error, {
        sensitive,
        generic: 'queue: encode failed',
      });
      throw sensitive ? scrubbed(error, 'queue: encode failed') : error;
    }
    const key = this.#key(topic);
    const fields = ['payload', encoded];
    if (sensitive) fields.push('sensitive', '1');
    let id: string;
    try {
      const written = await this.#lifecycle.run('publish', ({ commands }) =>
        commands.xadd(key, 'MAXLEN', '~', this.#maxLen, '*', ...fields),
      );
      if (typeof written !== 'string') {
        throw new Error('queue: XADD did not return an id');
      }
      id = written;
    } catch (error) {
      await this.#parkPublish(topic, payload, error, {
        sensitive,
        generic: 'queue: XADD failed',
      });
      if (!(error instanceof Error)) throw new Error('queue: XADD failed');
      // ioredis puts the XADD args, payload included, on `error.command`. A lifecycle error holds no payload and keeps its class.
      throw sensitive && !LifecycleError.is(error)
        ? scrubbed(error, error.message)
        : error;
    }
    this.#topics.add(topic);
    try {
      await this.#trim(topic);
    } catch (error) {
      this.#logFailure(error, 'queue: XTRIM failed', {
        adapter: ADAPTER,
        connection: 'commands',
        topic,
      });
    }
    return id;
  }

  async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    const group = options.consumerGroup;
    const mapKey = `${topic}\0${group}`;
    const already = new Error(
      `queue: already subscribed to ${topic} group ${group}`,
    );
    if (this.#subs.has(mapKey)) throw already;
    const key = this.#key(topic);
    const startId = startIdOf(options.startFrom);
    await this.#lifecycle.run('subscribe', ({ commands }) =>
      createGroup(commands, key, group, startId),
    );
    if (this.#subs.has(mapKey)) throw already;
    // Throws `Stopped` when stop() began during the group create, so no connection opens.
    const blocking = this.#lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => openRedis(this.#redis),
      fields: { topic, group },
    });
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sub: Subscription = {
      topic,
      group,
      key,
      consumer: `hexok:${process.pid}:${randomUUID()}`,
      startId,
      onError: options.onError ?? 'retry',
      handler: options.handler as QueueHandler<unknown>,
      abort: new AbortController(),
      ack: (command) => this.#lifecycle.run('subscribe', command),
      inflight: new Set(),
      blocking,
      heartbeat: undefined,
      recovery: undefined,
      recovering: new Set(),
      done,
      finish,
    };
    this.#subs.set(mapKey, sub);
    this.#topics.add(topic);
    const heartbeatMs = Math.max(1, Math.floor(this.#visibilityMs / 3));
    const recoveryMs = Math.max(1, Math.floor(this.#visibilityMs / 2));
    sub.heartbeat = setInterval(() => {
      void this.#heartbeat(sub);
    }, heartbeatMs);
    sub.recovery = setInterval(() => {
      // A slow run would otherwise overlap the next and claim the same entries twice.
      if (sub.recovering.size > 0) return;
      const run = this.#recover(sub).finally(() => {
        sub.recovering.delete(run);
      });
      sub.recovering.add(run);
    }, recoveryMs);
    void this.#readLoop(sub);
  }

  /**
   * Ends one subscription the way `stop()` ends them all, within `stopTimeoutMs`.
   * It waits for the subscription's handlers, then removes its consumer when nothing was in flight.
   */
  async unsubscribe(
    topic: string,
    options: { readonly consumerGroup: string },
  ): Promise<void> {
    const mapKey = `${topic}\0${options.consumerGroup}`;
    const sub = this.#subs.get(mapKey);
    if (!sub) return;
    this.#closeSub(sub);
    // Redis can stop answering mid-call, and ioredis would hold the release until it returns.
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `queue: unsubscribe() stopped waiting for Redis after ${this.#stopTimeoutMs}ms. maintain() removes a consumer left behind.`,
        ),
      );
    }, this.#stopTimeoutMs);
    const run: CommandRun = (command) =>
      this.#lifecycle.run('unsubscribe', command, { signal: deadline.signal });
    sub.ack = run;
    try {
      if (this.#handling.getStore() !== sub) {
        await settledOrAborted(handlersOf(sub), deadline.signal);
      }
      sub.ack = undefined;
      if (!deadline.signal.aborted) await this.#releaseConsumer(sub, run);
    } finally {
      sub.ack = undefined;
      clearTimeout(timer);
    }
    // stop() and a new subscribe() can run while this waits. Only this subscription's entry is removed.
    if (this.#subs.get(mapKey) === sub) this.#subs.delete(mapKey);
  }

  async maintain(
    options: RedisQueueMaintainOptions = {},
  ): Promise<RedisQueueMaintainReport> {
    this.#lifecycle.assertReady('maintain');
    return maintainStreams({
      run: (command) =>
        this.#lifecycle.run('maintain', ({ commands }) => command(commands)),
      keyPrefix: this.#keyPrefix,
      retentionMs: this.#retentionMs,
      options,
      logger: this.#logger,
    });
  }

  override stop(): Promise<void> {
    return this.#lifecycle.stop(async ({ run, signal }) => {
      clearInterval(this.#trimTimer);
      this.#trimTimer = undefined;
      const subs = [...this.#subs.values()];
      this.#subs.clear();
      const stopRun: CommandRun = (command) => run('stop', command);
      for (const sub of subs) {
        this.#closeSub(sub);
        // A handler that finishes during a deploy is acked, so its entry is not delivered again.
        sub.ack = stopRun;
      }
      // Handlers finish before consumers are released. `signal` aborts when stop() stops waiting.
      const caller = this.#handling.getStore();
      const others = subs.filter((sub) => sub !== caller);
      await settledOrAborted(Promise.all(others.map(handlersOf)), signal);
      for (const sub of subs) sub.ack = undefined;
      if (signal.aborted) return;
      await Promise.all(subs.map((sub) => this.#releaseConsumer(sub, stopRun)));
    });
  }

  /**
   * Removes this subscription's consumer with one script that keeps it when it owns a pending entry.
   * A consumer kept that way is left for `XAUTOCLAIM` or `maintain()`.
   */
  async #releaseConsumer(sub: Subscription, run: CommandRun): Promise<void> {
    if (sub.inflight.size > 0) return;
    try {
      await run(({ commands }) =>
        // A client that is not ready holds the script in its offline queue until stop() gives up.
        commands.status === 'ready'
          ? releaseConsumer(commands, sub.key, sub.group, sub.consumer)
          : Promise.resolve(false),
      );
    } catch (error) {
      this.#logFailure(
        error,
        'queue: consumer release failed',
        this.#fields(sub, 'commands'),
      );
    }
  }

  /** Aborts the read, clears the timers, and disconnects the blocking client. A `QUIT` after that could wait in the offline queue. */
  #closeSub(sub: Subscription): void {
    sub.abort.abort(new Error('queue: the subscription was closed'));
    if (sub.heartbeat) clearInterval(sub.heartbeat);
    if (sub.recovery) clearInterval(sub.recovery);
    sub.heartbeat = undefined;
    sub.recovery = undefined;
    this.#lifecycle.detach(sub.blocking);
  }

  async #readLoop(sub: Subscription): Promise<void> {
    const { signal } = sub.abort;
    let failures = 0;
    try {
      while (!signal.aborted) {
        let rows: StreamRead[] | null;
        try {
          // `run` adds the abort listener for this one read and removes it when the read settles,
          // so a settled read and its payload are not retained until the subscription aborts.
          // The signal also ends a read on a reconnecting client, which never settles, even after disconnect.
          rows = await this.#lifecycle.run(
            'subscribe',
            () =>
              sub.blocking.xreadgroup(
                'GROUP',
                sub.group,
                sub.consumer,
                'COUNT',
                this.#batch,
                'BLOCK',
                this.#blockMs,
                'STREAMS',
                sub.key,
                '>',
              ) as Promise<StreamRead[] | null>,
            { signal },
          );
          failures = 0;
        } catch (error) {
          if (signal.aborted || LifecycleError.is(error)) break;
          if (isNoGroup(error)) {
            if (await this.#restoreGroup(sub)) continue;
            failures += 1;
            await sleep(backoffMs(failures), signal);
            continue;
          }
          failures += 1;
          this.#logFailure(
            error,
            'queue: XREADGROUP failed',
            this.#fields(sub, 'blocking'),
          );
          await sleep(backoffMs(failures), signal);
          continue;
        }
        if (!rows) continue;
        for (const [, entries] of rows) await this.#handleBatch(sub, entries);
      }
    } finally {
      sub.finish();
    }
  }

  /** A sensitive publish parks `{ sensitive: true }` and a `generic` error that keeps only `name` and `code`. */
  async #parkPublish(
    topic: string,
    payload: unknown,
    error: unknown,
    options: { sensitive: boolean; generic: string },
  ): Promise<void> {
    await courtesyPark(
      this.#quarantine,
      {
        source: 'queue',
        operation: 'publish',
        subject: topic,
        payload: options.sensitive ? { sensitive: true } : payload,
        error: parkedError(
          options.sensitive ? scrubbed(error, options.generic) : error,
        ),
        occurredAt: new Date(),
        // Redis may have stored it, so a replay from quarantine can duplicate it.
        context:
          LifecycleError.is(error) && error.code === 'StoppedBeforeReply'
            ? { adapter: 'redis', outcome: 'unknown' }
            : { adapter: 'redis' },
      },
      this.#logger,
    );
  }

  async #parkDeliver(
    sub: Subscription,
    id: string,
    record: { payload: unknown; error: ReturnType<typeof parkedError> },
  ): Promise<void> {
    await courtesyPark(
      this.#quarantine,
      {
        source: 'queue',
        operation: 'deliver',
        subject: `${sub.topic}:${id}`,
        payload: record.payload,
        error: record.error,
        occurredAt: new Date(),
        context: { adapter: 'redis' },
      },
      this.#logger,
    );
  }

  /**
   * Every entry of a batch joins the heartbeat when the batch arrives, not when its turn comes.
   * Otherwise an entry waiting behind slow handlers goes idle, and `XAUTOCLAIM`, even this subscription's own, delivers it again.
   */
  async #handleBatch(sub: Subscription, entries: StreamEntry[]): Promise<void> {
    for (const [id] of entries) sub.inflight.add(id);
    for (const [id, fields] of entries) {
      if (sub.abort.signal.aborted) sub.inflight.delete(id);
      else await this.#dispatch(sub, id, fields);
    }
  }

  async #dispatch(
    sub: Subscription,
    id: string,
    fields: string[],
  ): Promise<void> {
    const raw = fieldOf(fields, 'payload');
    if (raw === undefined) {
      await this.#parkDeliver(sub, id, {
        payload: { reason: 'missing-payload' },
        error: { name: 'Error', message: 'queue: missing payload' },
      });
      await this.#settle(sub, id, 'drop');
      return;
    }
    let payload: unknown;
    try {
      payload = this.#decode(raw);
    } catch (error) {
      // A decode error can quote the raw payload. A sensitive entry gets a generic one.
      const sensitive = fieldOf(fields, 'sensitive') === '1';
      const generic = new Error('queue: decode failed');
      this.#logger.error(
        !sensitive && error instanceof Error ? error : generic,
        { adapter: ADAPTER, topic: sub.topic, group: sub.group, id },
      );
      await this.#parkDeliver(sub, id, {
        payload: sensitive
          ? { reason: 'decode-failed', sensitive: true }
          : { reason: 'decode-failed', raw },
        error: parkedError(sensitive ? generic : error),
      });
      await this.#settle(sub, id, 'drop');
      return;
    }
    let thrown = false;
    let returned: QueueDisposition | void;
    try {
      returned = await this.#handling.run(sub, () =>
        sub.handler({ id, topic: sub.topic, payload }),
      );
    } catch (error) {
      thrown = true;
      returned = undefined;
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: handler failed'),
        { adapter: ADAPTER, topic: sub.topic, group: sub.group, id },
      );
    }
    const disposition = dispositionOf(returned, thrown, sub.onError);
    await this.#settle(sub, id, disposition);
  }

  /** Once `unsubscribe` or `stop()` stops waiting, a handler that returns does not `XACK`. Its entry stays pending for another consumer. */
  async #settle(
    sub: Subscription,
    id: string,
    disposition: QueueDisposition,
  ): Promise<void> {
    const ack = sub.ack;
    if (ack === undefined || disposition === 'retry') {
      sub.inflight.delete(id);
      return;
    }
    try {
      await ack(({ commands }) => commands.xack(sub.key, sub.group, id));
    } catch (error) {
      this.#logFailure(error, 'queue: XACK failed', {
        ...this.#fields(sub, 'commands'),
        id,
      });
    }
    sub.inflight.delete(id);
  }

  async #heartbeat(sub: Subscription): Promise<void> {
    if (sub.abort.signal.aborted) return;
    const ids = [...sub.inflight];
    if (ids.length === 0) return;
    try {
      await this.#lifecycle.run('subscribe', ({ commands }) =>
        commands.xclaim(sub.key, sub.group, sub.consumer, 0, ...ids, 'JUSTID'),
      );
    } catch (error) {
      this.#logFailure(
        error,
        'queue: XCLAIM failed',
        this.#fields(sub, 'commands'),
      );
    }
  }

  async #recover(sub: Subscription): Promise<void> {
    if (sub.abort.signal.aborted) return;
    try {
      const reply = await this.#lifecycle.run('subscribe', ({ commands }) =>
        commands.xautoclaim(
          sub.key,
          sub.group,
          sub.consumer,
          this.#visibilityMs,
          '0-0',
          'COUNT',
          this.#batch,
        ),
      );
      // Redis 7 lists deleted ids as a third element and drops them itself. Redis 6.2 returns each as `nil` and keeps it pending.
      const claimed = Array.isArray(reply[1]) ? (reply[1] as unknown[]) : [];
      const entries = claimed.filter(isStreamEntry);
      if (entries.length < claimed.length) {
        await this.#lifecycle.run('subscribe', ({ commands }) =>
          ackDeleted(commands, sub.key, sub.group, sub.consumer),
        );
      }
      await this.#handleBatch(
        sub,
        entries.filter(([id]) => !sub.inflight.has(id)),
      );
    } catch (error) {
      if (sub.abort.signal.aborted) return;
      if (isNoGroup(error)) {
        await this.#restoreGroup(sub);
        return;
      }
      this.#logFailure(
        error,
        'queue: XAUTOCLAIM failed',
        this.#fields(sub, 'commands'),
      );
    }
  }

  /** Recreates a group deleted under a running subscription. Logs a failure and returns false. */
  async #restoreGroup(sub: Subscription): Promise<boolean> {
    try {
      await this.#lifecycle.run('subscribe', ({ commands }) =>
        createGroup(commands, sub.key, sub.group, sub.startId),
      );
      return true;
    } catch (error) {
      // After stop(), the read loop sees the abort and ends.
      if (LifecycleError.is(error)) return true;
      if (!sub.abort.signal.aborted) {
        this.#logFailure(
          error,
          'queue: XGROUP CREATE failed',
          this.#fields(sub, 'commands'),
        );
      }
      return false;
    }
  }

  async #trim(topic: string): Promise<void> {
    const minId = `${Date.now() - this.#retentionMs}-0`;
    await this.#lifecycle.run('publish', ({ commands }) =>
      commands.xtrim(this.#key(topic), 'MINID', '~', minId),
    );
  }

  async #trimAll(): Promise<void> {
    for (const topic of this.#topics) {
      try {
        await this.#trim(topic);
      } catch (error) {
        this.#logFailure(error, 'queue: age trim failed', {
          adapter: ADAPTER,
          connection: 'commands',
          topic,
        });
      }
    }
  }

  /** Logs a failed command. A lifecycle error means stop() cut the command short, which is not a failure. */
  #logFailure(
    error: unknown,
    fallback: string,
    fields: Record<string, unknown>,
  ): void {
    if (LifecycleError.is(error)) return;
    this.#logger.error(
      error instanceof Error ? error : new Error(fallback),
      fields,
    );
  }

  #fields(
    sub: Subscription,
    connection: 'commands' | 'blocking',
  ): Record<string, unknown> {
    return { adapter: ADAPTER, connection, topic: sub.topic, group: sub.group };
  }

  #key(topic: string): string {
    return `${this.#keyPrefix}${topic}`;
  }
}

/** Waits longer after each failed read, up to 5 seconds. */
function backoffMs(failures: number): number {
  return Math.min(1000 * failures, 5000);
}
