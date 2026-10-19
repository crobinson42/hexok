import { randomUUID } from 'node:crypto';
import {
  dispositionOf,
  Queue,
  type QueueDisposition,
  type QueueHandler,
  type QueueStartFrom,
  type QueueSubscribeOptions,
} from '@hexok/queue';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { decodeJson, encodeJson, openRedis } from './codec.js';
import { type LogSink, noopSink } from './log-sink.js';

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

function payloadField(fields: string[]): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === 'payload') return fields[i + 1];
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
  #commands: Redis | undefined;
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
  }

  async start(): Promise<void> {
    if (this.#commands) return;
    this.#commands = openRedis(this.#redis);
    this.#trimTimer = setInterval(() => {
      void this.#trimAll();
    }, 60_000);
  }

  async publish(topic: string, payload: unknown): Promise<string> {
    const commands = this.#requireCommands();
    const encoded = this.#encode(payload);
    const key = this.#key(topic);
    let id: string;
    try {
      const written = await commands.xadd(
        key,
        'MAXLEN',
        '~',
        this.#maxLen,
        '*',
        'payload',
        encoded,
      );
      if (typeof written !== 'string') {
        throw new Error('queue: XADD did not return an id');
      }
      id = written;
    } catch (error) {
      throw error instanceof Error ? error : new Error('queue: XADD failed');
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
    if (this.#subs.has(mapKey)) {
      throw new Error(
        `queue: already subscribed to ${topic} group ${options.consumerGroup}`,
      );
    }
    const key = this.#key(topic);
    const startId = startIdOf(options.startFrom);
    await this.#createGroup(commands, key, options.consumerGroup, startId);
    const blocking = openRedis(this.#redis);
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
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
    await this.#closeSub(sub, false);
    this.#subs.delete(mapKey);
  }

  override async stop(): Promise<void> {
    for (const sub of this.#subs.values()) {
      sub.aborted = true;
      this.#clearSubTimers(sub);
    }
    if (this.#trimTimer) {
      clearInterval(this.#trimTimer);
      this.#trimTimer = undefined;
    }
    for (const sub of this.#subs.values()) {
      sub.blocking.disconnect();
    }
    await Promise.race([
      Promise.all([...this.#subs.values()].map((sub) => sub.done)),
      new Promise<void>((resolve) => {
        setTimeout(resolve, this.#visibilityMs);
      }),
    ]);
    for (const sub of this.#subs.values()) {
      sub.inflight.clear();
    }
    const commands = this.#commands;
    this.#commands = undefined;
    if (commands) {
      await commands.quit().catch((error: unknown) => {
        this.#logger.error(
          error instanceof Error ? error : new Error('queue: quit failed'),
        );
      });
    }
    for (const sub of this.#subs.values()) {
      await sub.blocking.quit().catch(() => undefined);
    }
    this.#subs.clear();
  }

  async #closeSub(sub: Subscription, wait: boolean): Promise<void> {
    sub.aborted = true;
    this.#clearSubTimers(sub);
    sub.blocking.disconnect();
    if (wait) {
      await Promise.race([
        sub.done,
        new Promise<void>((resolve) => {
          setTimeout(resolve, this.#visibilityMs);
        }),
      ]);
    }
    await sub.blocking.quit().catch(() => undefined);
  }

  #clearSubTimers(sub: Subscription): void {
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
          rows = (await sub.blocking.xreadgroup(
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
          )) as StreamRead[] | null;
          failures = 0;
        } catch (error) {
          if (sub.aborted) break;
          if (isNoGroup(error)) {
            const commands = this.#commands;
            if (commands) {
              await this.#createGroup(
                commands,
                sub.key,
                sub.group,
                sub.startId,
              );
            }
            continue;
          }
          failures += 1;
          this.#logger.error(
            error instanceof Error
              ? error
              : new Error('queue: XREADGROUP failed'),
            { topic: sub.topic },
          );
          await this.#backoff(failures);
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

  async #dispatch(
    sub: Subscription,
    id: string,
    fields: string[],
  ): Promise<void> {
    const raw = payloadField(fields);
    if (raw === undefined) {
      await this.#settle(sub, id, 'drop', false);
      return;
    }
    let payload: unknown;
    try {
      payload = this.#decode(raw);
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: decode failed'),
        { topic: sub.topic, id },
      );
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
        await this.#createGroup(commands, sub.key, sub.group, sub.startId);
        return;
      }
      this.#logger.error(
        error instanceof Error ? error : new Error('queue: XAUTOCLAIM failed'),
        { topic: sub.topic },
      );
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

  async #backoff(failures: number): Promise<void> {
    const ms = Math.min(1000 * failures, 5000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
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
