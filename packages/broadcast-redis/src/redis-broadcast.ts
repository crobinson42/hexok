import {
  Broadcast,
  type BroadcastHandler,
  type Channel,
} from '@hexok/broadcast';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { decodeJson, encodeJson, openRedis } from './codec.js';
import { type LogSink, noopSink } from './log-sink.js';

export interface RedisBroadcastConfig {
  readonly redis: string | RedisOptions;
  readonly channelPrefix?: string;
  readonly encode?: (payload: unknown) => string;
  readonly decode?: (raw: string) => unknown;
  readonly logger?: LogSink;
}

export class RedisBroadcast extends Adapter(Broadcast) {
  readonly #redis: string | RedisOptions;
  readonly #channelPrefix: string;
  readonly #encode: (payload: unknown) => string;
  readonly #decode: (raw: string) => unknown;
  readonly #logger: LogSink;
  #publisher: Redis | undefined;
  #subscriber: Redis | undefined;
  readonly #handlers = new Map<string, Set<BroadcastHandler<unknown>>>();

  constructor(config: RedisBroadcastConfig) {
    super();
    this.#redis = config.redis;
    this.#channelPrefix = config.channelPrefix ?? 'hexok:broadcast:';
    this.#encode = config.encode ?? encodeJson;
    this.#decode = config.decode ?? decodeJson;
    this.#logger = config.logger ?? noopSink;
  }

  async start(): Promise<void> {
    if (this.#publisher) return;
    this.#publisher = openRedis(this.#redis);
    this.#subscriber = openRedis(this.#redis);
    this.#subscriber.on('message', (wire: string, raw: string) => {
      void this.#deliver(wire, raw);
    });
  }

  async publish<Name extends string, T>(
    channel: Channel<Name, T>,
    payload: T,
  ): Promise<void> {
    const publisher = this.#requirePublisher();
    const encoded = this.#encode(payload);
    await publisher.publish(this.#wire(channel.name), encoded);
  }

  async subscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const subscriber = this.#requireSubscriber();
    const set = this.#handlers.get(channel.name) ?? new Set();
    const first = set.size === 0;
    set.add(handler as BroadcastHandler<unknown>);
    this.#handlers.set(channel.name, set);
    if (first) await subscriber.subscribe(this.#wire(channel.name));
  }

  async unsubscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const set = this.#handlers.get(channel.name);
    if (!set) return;
    set.delete(handler as BroadcastHandler<unknown>);
    if (set.size > 0) return;
    this.#handlers.delete(channel.name);
    await this.#subscriber?.unsubscribe(this.#wire(channel.name));
  }

  override async stop(): Promise<void> {
    const channels = [...this.#handlers.keys()];
    this.#handlers.clear();
    if (this.#subscriber && channels.length > 0) {
      await this.#subscriber.unsubscribe(
        ...channels.map((channel) => this.#wire(channel)),
      );
    }
    await this.#subscriber?.quit().catch((error: unknown) => {
      this.#logger.error(
        error instanceof Error ? error : new Error('broadcast: quit failed'),
      );
    });
    await this.#publisher?.quit().catch((error: unknown) => {
      this.#logger.error(
        error instanceof Error ? error : new Error('broadcast: quit failed'),
      );
    });
    this.#subscriber = undefined;
    this.#publisher = undefined;
  }

  async #deliver(wire: string, raw: string): Promise<void> {
    const channel = wire.startsWith(this.#channelPrefix)
      ? wire.slice(this.#channelPrefix.length)
      : wire;
    let payload: unknown;
    try {
      payload = this.#decode(raw);
    } catch (error) {
      this.#logger.error(
        error instanceof Error ? error : new Error('broadcast: decode failed'),
        { channel },
      );
      return;
    }
    const handlers = [...(this.#handlers.get(channel) ?? [])];
    for (const handler of handlers) {
      try {
        await Promise.resolve(handler({ channel, payload }));
      } catch (error) {
        this.#logger.error(
          error instanceof Error
            ? error
            : new Error('broadcast: handler failed'),
          { channel },
        );
      }
    }
  }

  #wire(channel: string): string {
    return `${this.#channelPrefix}${channel}`;
  }

  #requirePublisher(): Redis {
    if (!this.#publisher) throw new Error('broadcast: start() was not called');
    return this.#publisher;
  }

  #requireSubscriber(): Redis {
    if (!this.#subscriber) throw new Error('broadcast: start() was not called');
    return this.#subscriber;
  }
}
