import { randomUUID } from 'node:crypto';
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
import { decodeJson, encodeJson, openRedis, untilReady } from './codec.js';
import { type LogSink, noopSink } from './log-sink.js';
import {
  maintainStreams,
  type RedisQueueMaintainOptions,
  type RedisQueueMaintainReport,
  type RedisQueueMaintainSkipReason,
  type RedisQueueStuckReason,
} from './maintain.js';
import { courtesyPark, type ParkSink, parkedError } from './park.js';

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
  readonly encode?: (payload: unknown) => string;
  readonly decode?: (raw: string) => unknown;
  readonly logger?: LogSink;
  readonly quarantine?: ParkSink;
}

interface Subscription {
  topic: string;
  group: string;
  key: string;
  consumer: string;
  startId: string;
  onError: QueueDisposition;
  handler: QueueHandler<unknown>;
  aborted: boolean;
  inflight: Set<string>;
  blocking: Redis;
  heartbeat: ReturnType<typeof setInterval> | undefined;
  recovery: ReturnType<typeof setInterval> | undefined;
  /** Resolves when the subscription aborts. A read or backoff races it. */
  aborting: Promise<void>;
  wake: () => void;
  done: Promise<void>;
  finish: () => void;
}

type StreamEntry = [string, string[]];
type StreamRead = [string, StreamEntry[]];

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

/** Waits for `promise` or `ms`, whichever is first, and clears the timer. */
async function settleWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

function fieldOf(fields: string[], name: string): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === name) return fields[i + 1];
  }
  return undefined;
}

export class RedisQueue extends Adapter(Queue) {
  readonly #redis: string | RedisOptions;
  readonly #keyPrefix: string;
  readonly #visibilityMs: number;
  readonly #batch: number;
  readonly #blockMs: number;
  readonly #maxLen: number;
  readonly #retentionMs: number;
  readonly #encode: (payload: unknown) => string;
  readonly #decode: (raw: string) => unknown;
  readonly #logger: LogSink;
  readonly #quarantine: ParkSink | undefined;
  #commands: Redis | undefined;
  #starting:
    | { client: Redis; ready: Promise<void>; abort: AbortController }
    | undefined;
  #trimTimer: ReturnType<typeof setInterval> | undefined;
  readonly #topics = new Set<string>();
  readonly #subs = new Map<string, Subscription>();

  constructor(config: RedisQueueConfig) {
    super();
    this.#redis = config.redis;
    this.#keyPrefix = config.keyPrefix ?? 'hexok:queue:';
    this.#visibilityMs = config.visibilityMs ?? 30_000;
    this.#batch = config.batch ?? 10;
    this.#blockMs = config.blockMs ?? 1000;
    this.#maxLen = config.maxLen ?? 10_000;
    this.#retentionMs = config.retentionMs ?? 86_400_000;
    this.#encode = config.encode ?? encodeJson;
    this.#decode = config.decode ?? decodeJson;
    this.#logger = config.logger ?? noopSink;
    this.#quarantine = config.quarantine;
  }

  async start(): Promise<void> {
    if (this.#commands) return;
    if (!this.#starting) {
      const client = openRedis(this.#redis);
      client.on('error', (error: Error) => {
        this.#logger.error(error, { connection: 'commands' });
      });
      const abort = new AbortController();
      this.#starting = {
        client,
        ready: untilReady(client, abort.signal),
        abort,
      };
    }
    const { client, ready } = this.#starting;
    try {
      await ready;
    } catch (error) {
      if (this.#starting?.client === client) this.#starting = undefined;
      throw error;
    }
    if (this.#commands) return;
    if (this.#starting?.client !== client) {
      throw new Error('queue: stop() was called before ready');
    }
    this.#starting = undefined;
    this.#commands = client;
    this.#trimTimer = setInterval(() => {
      void this.#trimAll();
    }, 60_000);
  }

  async publish(
    topic: string,
    payload: unknown,
    options: QueuePublishOptions = {},
  ): Promise<string> {
    const commands = this.#requireCommands();
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
      const written = await commands.xadd(
        key,
        'MAXLEN',
        '~',
        this.#maxLen,
        '*',
        ...fields,
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
      // ioredis puts the XADD args, payload included, on `error.command`.
      throw sensitive ? scrubbed(error, error.message) : error;
    }
    this.#topics.add(topic);
    try {
      await this.#trim(topic);
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: XTRIM failed'),
        { topic },
      );
    }
    return id;
  }

  async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    const commands = this.#requireCommands();
    const mapKey = `${topic}\0${options.consumerGroup}`;
    const already = new Error(
      `queue: already subscribed to ${topic} group ${options.consumerGroup}`,
    );
    if (this.#subs.has(mapKey)) throw already;
    const key = this.#key(topic);
    const startId = startIdOf(options.startFrom);
    await this.#createGroup(commands, key, options.consumerGroup, startId);
    if (this.#commands !== commands) {
      throw new Error('queue: stop() was called during subscribe');
    }
    if (this.#subs.has(mapKey)) throw already;
    const blocking = openRedis(this.#redis);
    blocking.on('error', (error: Error) => {
      this.#logger.error(error, { topic, connection: 'blocking' });
    });
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let wake = () => {};
    const aborting = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const sub: Subscription = {
      topic,
      group: options.consumerGroup,
      key,
      consumer: `hexok:${process.pid}:${randomUUID()}`,
      startId,
      onError: options.onError ?? 'retry',
      handler: options.handler as QueueHandler<unknown>,
      aborted: false,
      inflight: new Set(),
      blocking,
      heartbeat: undefined,
      recovery: undefined,
      aborting,
      wake,
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
      void this.#recover(sub);
    }, recoveryMs);
    void this.#readLoop(sub);
  }

  async unsubscribe(
    topic: string,
    options: { readonly consumerGroup: string },
  ): Promise<void> {
    const mapKey = `${topic}\0${options.consumerGroup}`;
    const sub = this.#subs.get(mapKey);
    if (!sub) return;
    const idle = sub.inflight.size === 0;
    await this.#closeSub(sub, false);
    const commands = this.#commands;
    if (commands && idle) await this.#releaseConsumer(commands, sub);
    this.#subs.delete(mapKey);
  }

  async maintain(
    options: RedisQueueMaintainOptions = {},
  ): Promise<RedisQueueMaintainReport> {
    const commands = this.#requireCommands();
    return maintainStreams({
      commands,
      keyPrefix: this.#keyPrefix,
      retentionMs: this.#retentionMs,
      options,
      logger: this.#logger,
    });
  }

  override async stop(): Promise<void> {
    const starting = this.#starting;
    this.#starting = undefined;
    if (starting) {
      starting.abort.abort(new Error('queue: stop() was called before ready'));
      starting.client.disconnect();
    }
    const commands = this.#commands;
    this.#commands = undefined;
    if (this.#trimTimer) {
      clearInterval(this.#trimTimer);
      this.#trimTimer = undefined;
    }
    const subs = [...this.#subs.values()];
    this.#subs.clear();
    const idleSubs = subs.filter((sub) => sub.inflight.size === 0);
    for (const sub of subs) {
      this.#abortSub(sub);
      sub.blocking.disconnect();
    }
    const deadline = Date.now() + this.#visibilityMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    await settleWithin(Promise.all(subs.map((sub) => sub.done)), remaining());
    if (commands) {
      await settleWithin(
        Promise.all(
          idleSubs.map((sub) => this.#releaseConsumer(commands, sub)),
        ),
        remaining(),
      );
      let closed = false;
      if (commands.status === 'ready' && remaining() > 0) {
        await settleWithin(
          commands.quit().then(
            () => {
              closed = true;
            },
            (error: unknown) => {
              this.#logger.error(
                error instanceof Error
                  ? error
                  : new Error('queue: quit failed'),
              );
            },
          ),
          remaining(),
        );
      }
      if (!closed) commands.disconnect();
    }
    for (const sub of subs) {
      sub.inflight.clear();
    }
  }

  /** Skips a client that is not ready, since ioredis would queue the command until Redis returns. */
  async #releaseConsumer(commands: Redis, sub: Subscription): Promise<void> {
    if (sub.inflight.size > 0 || commands.status !== 'ready') return;
    try {
      await commands.xgroup('DELCONSUMER', sub.key, sub.group, sub.consumer);
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: DELCONSUMER failed'),
        { topic: sub.topic, group: sub.group },
      );
    }
  }

  /** `disconnect` alone closes the blocking client. A `quit` after it can wait in the offline queue forever. */
  async #closeSub(sub: Subscription, wait: boolean): Promise<void> {
    this.#abortSub(sub);
    sub.blocking.disconnect();
    if (wait) await settleWithin(sub.done, this.#visibilityMs);
  }

  #abortSub(sub: Subscription): void {
    sub.aborted = true;
    sub.wake();
    if (sub.heartbeat) clearInterval(sub.heartbeat);
    if (sub.recovery) clearInterval(sub.recovery);
    sub.heartbeat = undefined;
    sub.recovery = undefined;
  }

  async #readLoop(sub: Subscription): Promise<void> {
    let failures = 0;
    try {
      while (!sub.aborted) {
        let rows: StreamRead[] | null;
        try {
          // A reconnecting client never settles the read, even after `disconnect`.
          rows = (await Promise.race([
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
            ),
            sub.aborting.then(() => null),
          ])) as StreamRead[] | null;
          failures = 0;
        } catch (error) {
          if (sub.aborted) break;
          if (isNoGroup(error)) {
            if (await this.#restoreGroup(sub)) continue;
            failures += 1;
            await this.#backoff(sub, failures);
            continue;
          }
          failures += 1;
          this.#logger.error(
            error instanceof Error
              ? error
              : new Error('queue: XREADGROUP failed'),
            { topic: sub.topic },
          );
          await this.#backoff(sub, failures);
          continue;
        }
        if (!rows) continue;
        for (const [, entries] of rows) {
          for (const [id, fields] of entries) {
            if (sub.aborted) break;
            await this.#dispatch(sub, id, fields);
          }
        }
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
        context: { adapter: 'redis' },
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
      await this.#settle(sub, id, 'drop', false);
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
        { topic: sub.topic, id },
      );
      await this.#parkDeliver(sub, id, {
        payload: sensitive
          ? { reason: 'decode-failed', sensitive: true }
          : { reason: 'decode-failed', raw },
        error: parkedError(sensitive ? generic : error),
      });
      await this.#settle(sub, id, 'drop', false);
      return;
    }
    sub.inflight.add(id);
    let thrown = false;
    let returned: QueueDisposition | void;
    try {
      returned = await sub.handler({ id, topic: sub.topic, payload });
    } catch (error) {
      thrown = true;
      returned = undefined;
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: handler failed'),
        { topic: sub.topic, id },
      );
    }
    const disposition = dispositionOf(returned, thrown, sub.onError);
    await this.#settle(sub, id, disposition, true);
  }

  async #settle(
    sub: Subscription,
    id: string,
    disposition: QueueDisposition,
    tracked: boolean,
  ): Promise<void> {
    if (sub.aborted) {
      if (tracked) sub.inflight.delete(id);
      return;
    }
    if (disposition === 'retry') {
      if (tracked) sub.inflight.delete(id);
      return;
    }
    const commands = this.#commands;
    if (!commands || sub.aborted) {
      if (tracked) sub.inflight.delete(id);
      return;
    }
    try {
      await commands.xack(sub.key, sub.group, id);
    } catch (error) {
      if (!sub.aborted) {
        this.#logger.error(
          error instanceof Error ? error : new Error('queue: XACK failed'),
          { topic: sub.topic, id },
        );
      }
    }
    if (tracked) sub.inflight.delete(id);
  }

  async #heartbeat(sub: Subscription): Promise<void> {
    if (sub.aborted) return;
    const ids = [...sub.inflight];
    if (ids.length === 0) return;
    const commands = this.#commands;
    if (!commands || sub.aborted) return;
    try {
      await commands.xclaim(
        sub.key,
        sub.group,
        sub.consumer,
        0,
        ...ids,
        'JUSTID',
      );
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: XCLAIM failed'),
        { topic: sub.topic },
      );
    }
  }

  async #recover(sub: Subscription): Promise<void> {
    if (sub.aborted) return;
    const commands = this.#commands;
    if (!commands) return;
    try {
      const claimed = (await commands.xautoclaim(
        sub.key,
        sub.group,
        sub.consumer,
        this.#visibilityMs,
        '0-0',
        'COUNT',
        this.#batch,
      )) as [string, StreamEntry[]];
      const entries = claimed[1] ?? [];
      for (const [id, fields] of entries) {
        if (sub.aborted) return;
        if (sub.inflight.has(id)) continue;
        await this.#dispatch(sub, id, fields);
      }
    } catch (error) {
      if (sub.aborted) return;
      if (isNoGroup(error)) {
        await this.#restoreGroup(sub);
        return;
      }
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: XAUTOCLAIM failed'),
        { topic: sub.topic },
      );
    }
  }

  /** Recreates a group deleted under a running subscription. Logs a failure and returns false. */
  async #restoreGroup(sub: Subscription): Promise<boolean> {
    const commands = this.#commands;
    if (!commands) return true;
    try {
      await this.#createGroup(commands, sub.key, sub.group, sub.startId);
      return true;
    } catch (error) {
      if (!sub.aborted) {
        this.#logger.error(
          error instanceof Error
            ? error
            : new Error('queue: XGROUP CREATE failed'),
          { topic: sub.topic },
        );
      }
      return false;
    }
  }

  async #createGroup(
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

  async #trim(topic: string): Promise<void> {
    const commands = this.#commands;
    if (!commands) return;
    const minId = `${Date.now() - this.#retentionMs}-0`;
    await commands.xtrim(this.#key(topic), 'MINID', '~', minId);
  }

  async #trimAll(): Promise<void> {
    for (const topic of this.#topics) {
      try {
        await this.#trim(topic);
      } catch (error) {
        this.#logger.error(
          error instanceof Error ? error : new Error('queue: age trim failed'),
          { topic },
        );
      }
    }
  }

  /** Sleeps before the next read. Aborting the subscription wakes it early. */
  async #backoff(sub: Subscription, failures: number): Promise<void> {
    await settleWithin(sub.aborting, Math.min(1000 * failures, 5000));
  }

  #key(topic: string): string {
    return `${this.#keyPrefix}${topic}`;
  }

  #requireCommands(): Redis {
    if (!this.#commands) {
      throw new Error('queue: start() was not called');
    }
    return this.#commands;
  }
}
