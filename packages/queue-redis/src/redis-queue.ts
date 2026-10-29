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
  assertMaxDeliveries,
  deliveryAllowed,
  dispositionOf,
  Queue,
  type QueueDisposition,
  type QueueHandler,
  type QueueMaxDeliveries,
  type QueuePublishOptions,
  type QueueStartFrom,
  type QueueSubscribeOptions,
  retryExhausted,
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
import {
  courtesyPark,
  type ParkedError,
  type ParkSink,
  parkedError,
} from './park.js';
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
   * How long `stop()` and `unsubscribe()` wait for handlers, consumer release, and `QUIT`. Default 10000.
   * A handler still running is no longer waited for. It keeps running until the process exits, and its entry is not acked,
   * so another consumer delivers it again after `visibilityMs`. A stop shorter than `visibilityMs` is safe, and 10 seconds fits the default Kubernetes grace period beside other adapters.
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
  readonly maxDeliveries: QueueMaxDeliveries;
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

/** One handler call. `active` turns false when the handler returns. */
interface HandlerCall {
  readonly sub: Subscription;
  active: boolean;
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

function deliveryCountOf(reply: unknown, id: string): number | undefined {
  if (!Array.isArray(reply)) return undefined;
  for (const row of reply) {
    if (!Array.isArray(row) || row[0] !== id) continue;
    return pendingCount(row[3]);
  }
  return undefined;
}

/** A pending-list counter. `0` and unsafe numbers are not a delivery count. */
function pendingCount(value: unknown): number | undefined {
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 1) return undefined;
  return count;
}

function exhaustedError(thrown: unknown): ParkedError {
  if (thrown === undefined) {
    return { name: 'Error', message: 'queue: deliveries exhausted' };
  }
  return { ...parkedError(thrown), message: 'queue: deliveries exhausted' };
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
   * The handler call running now. A handler that calls `unsubscribe` on its own subscription, or `stop()`, would otherwise wait for itself until `stopTimeoutMs`.
   * The mark is per call and ends when the handler returns. Work it leaves behind, such as a timer, inherits the context, and must not count as the handler.
   */
  readonly #handling = new AsyncLocalStorage<HandlerCall>();

  constructor(config: RedisQueueConfig) {
    super();
    this.#redis = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:queue:';
    this.#visibilityMs = config.visibilityMs ?? 30_000;
    this.#stopTimeoutMs = config.stopTimeoutMs ?? 10_000;
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

  /** `ready` from `start()` until `stop()`, even while Redis is down. Gate traffic on it, not Redis health. */
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
      this.#logFailure(error, 'XTRIM', {
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
    assertMaxDeliveries(options.maxDeliveries);
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
      maxDeliveries: options.maxDeliveries,
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
      if (!this.#calledFrom(sub)) {
        await settledOrAborted(handlersOf(sub), deadline.signal);
      }
      sub.ack = undefined;
      if (deadline.signal.aborted) {
        this.#logger.warn(
          `queue: unsubscribe() stopped waiting for handlers after ${this.#stopTimeoutMs}ms. The consumer is left for maintain().`,
          this.#fields(sub, 'commands'),
        );
      } else {
        await this.#releaseConsumer(sub, run);
      }
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
      const others = subs.filter((sub) => !this.#calledFrom(sub));
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
      await run(async ({ commands }) => {
        // A client that is not ready holds the script in its offline queue until stop() gives up.
        if (commands.status !== 'ready') return;
        await releaseConsumer(commands, sub.key, sub.group, sub.consumer);
      });
    } catch (error) {
      this.#logFailure(
        error,
        'consumer release',
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
          this.#logFailure(error, 'XREADGROUP', this.#fields(sub, 'blocking'));
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
    record: {
      payload: unknown;
      error: ParkedError;
      attempts?: number;
    },
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
        ...(record.attempts === undefined ? {} : { attempts: record.attempts }),
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
    const counts = sub.abort.signal.aborted
      ? new Map<string, number>()
      : await this.#deliveryCounts(
          sub,
          entries.map(([id]) => id),
        );
    for (const [id, fields] of entries) {
      if (sub.abort.signal.aborted) sub.inflight.delete(id);
      else await this.#dispatch(sub, id, fields, counts.get(id));
    }
  }

  /** One `XPENDING` per id. A missing or unusable count is left out of the map. */
  async #deliveryCounts(
    sub: Subscription,
    ids: readonly string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (ids.length === 0) return counts;
    let replies: Array<[Error | null, unknown]> | null;
    try {
      replies = await this.#lifecycle.run('subscribe', ({ commands }) => {
        const pipe = commands.pipeline();
        for (const id of ids) pipe.xpending(sub.key, sub.group, id, id, 1);
        return pipe.exec();
      });
    } catch (error) {
      this.#logFailure(error, 'XPENDING', this.#fields(sub, 'commands'));
      return counts;
    }
    if (!Array.isArray(replies)) return counts;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (id === undefined) continue;
      const item = replies[i];
      if (!Array.isArray(item)) continue;
      const [failed, reply] = item;
      if (failed) continue;
      const count = deliveryCountOf(reply, id);
      if (count !== undefined) counts.set(id, count);
    }
    return counts;
  }

  async #dispatch(
    sub: Subscription,
    id: string,
    fields: string[],
    deliveries: number | undefined,
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
    if (deliveries === undefined) {
      this.#logger.error(new Error('queue: delivery count missing'), {
        adapter: ADAPTER,
        topic: sub.topic,
        group: sub.group,
        id,
      });
      sub.inflight.delete(id);
      return;
    }
    if (!deliveryAllowed(deliveries, sub.maxDeliveries)) {
      await this.#giveUp(sub, id, deliveries, fields, payload);
      return;
    }
    let thrown = false;
    let thrownError: unknown;
    let returned: QueueDisposition | void;
    try {
      const call: HandlerCall = { sub, active: true };
      try {
        returned = await this.#handling.run(call, () =>
          sub.handler({ id, topic: sub.topic, payload, deliveries }),
        );
      } finally {
        call.active = false;
      }
    } catch (error) {
      thrown = true;
      thrownError = error;
      returned = undefined;
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: handler failed'),
        { adapter: ADAPTER, topic: sub.topic, group: sub.group, id },
      );
    }
    const disposition = dispositionOf(returned, thrown, sub.onError);
    if (
      disposition === 'retry' &&
      retryExhausted(deliveries, sub.maxDeliveries)
    ) {
      await this.#giveUp(sub, id, deliveries, fields, payload, thrownError);
      return;
    }
    await this.#settle(sub, id, disposition);
  }

  /** Logs, parks when a sink is set, then acknowledges. A failed park still acknowledges. */
  async #giveUp(
    sub: Subscription,
    id: string,
    deliveries: number,
    fields: string[],
    payload: unknown,
    thrown?: unknown,
  ): Promise<void> {
    this.#logger.error(new Error('queue: deliveries exhausted'), {
      adapter: ADAPTER,
      topic: sub.topic,
      group: sub.group,
      id,
      deliveries,
    });
    const sensitive = fieldOf(fields, 'sensitive') === '1';
    await this.#parkDeliver(sub, id, {
      payload: sensitive
        ? { reason: 'deliveries-exhausted', sensitive: true }
        : { reason: 'deliveries-exhausted', payload },
      error: exhaustedError(thrown),
      attempts: deliveries,
    });
    await this.#settle(sub, id, 'ack');
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
      this.#logFailure(error, 'XACK', {
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
      this.#logFailure(error, 'XCLAIM', this.#fields(sub, 'commands'));
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
      if (isNoGroup(error) && !sub.abort.signal.aborted) {
        await this.#restoreGroup(sub);
        return;
      }
      this.#logFailure(error, 'XAUTOCLAIM', this.#fields(sub, 'commands'));
    }
  }

  /** Recreates a group deleted under a running subscription. Logs a failure and returns false, unless the queue is stopping. */
  async #restoreGroup(sub: Subscription): Promise<boolean> {
    try {
      await this.#lifecycle.run('subscribe', ({ commands }) =>
        createGroup(commands, sub.key, sub.group, sub.startId),
      );
      return true;
    } catch (error) {
      this.#logFailure(error, 'XGROUP CREATE', this.#fields(sub, 'commands'));
      // After stop(), the read loop sees the abort and ends.
      return LifecycleError.is(error);
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
        this.#logFailure(error, 'XTRIM', {
          adapter: ADAPTER,
          connection: 'commands',
          topic,
        });
      }
    }
  }

  /**
   * Logs a failed background command. Redis may have run one that `stop()` cut short, so `StoppedBeforeReply` goes to `warn`.
   * `NotStarted`, `Starting`, and `Stopped` mean the queue was not running, which is not a failure.
   */
  #logFailure(
    error: unknown,
    command: string,
    fields: Record<string, unknown>,
  ): void {
    if (LifecycleError.is(error)) {
      if (error.code === 'StoppedBeforeReply') {
        this.#logger.warn(
          `queue: stop() stopped waiting before Redis replied to the ${command}. Redis may or may not have run it.`,
          { ...fields, code: error.code },
        );
      }
      return;
    }
    this.#logger.error(
      error instanceof Error ? error : new Error(`queue: ${command} failed`),
      fields,
    );
  }

  #fields(
    sub: Subscription,
    connection: 'commands' | 'blocking',
  ): Record<string, unknown> {
    return { adapter: ADAPTER, connection, topic: sub.topic, group: sub.group };
  }

  /** Whether a handler of `sub` is the caller and has not yet returned. */
  #calledFrom(sub: Subscription): boolean {
    const call = this.#handling.getStore();
    return call?.active === true && call.sub === sub;
  }

  #key(topic: string): string {
    return `${this.#keyPrefix}${topic}`;
  }
}

/** Waits longer after each failed read, up to 5 seconds. */
function backoffMs(failures: number): number {
  return Math.min(1000 * failures, 5000);
}
