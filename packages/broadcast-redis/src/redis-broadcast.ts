import {
  Broadcast,
  type BroadcastHandler,
  type Channel,
} from '@hexok/broadcast';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { decodeJson, encodeJson, openRedis, untilReady } from './codec.js';
import { type LogSink, noopSink } from './log-sink.js';

export interface RedisBroadcastConfig {
  readonly redis: string | RedisOptions;
  readonly channelPrefix?: string;
  readonly encode?: (payload: unknown) => string;
  readonly decode?: (raw: string) => unknown;
  readonly logger?: LogSink;
}

interface Listening {
  readonly handlers: Set<BroadcastHandler<unknown>>;
  readonly subscribed: Promise<void>;
}

export class RedisBroadcast extends Adapter(Broadcast) {
  readonly #redis: string | RedisOptions;
  readonly #channelPrefix: string;
  readonly #encode: (payload: unknown) => string;
  readonly #decode: (raw: string) => unknown;
  readonly #logger: LogSink;
  #publisher: Redis | undefined;
  #subscriber: Redis | undefined;
  #started: Promise<void> | undefined;
  #starting: AbortController | undefined;
  readonly #channels = new Map<string, Listening>();

  constructor(config: RedisBroadcastConfig) {
    super();
    this.#redis = config.redis;
    this.#channelPrefix = config.channelPrefix ?? 'hexok:broadcast:';
    this.#encode = config.encode ?? encodeJson;
    this.#decode = config.decode ?? decodeJson;
    this.#logger = config.logger ?? noopSink;
  }

  start(): Promise<void> {
    this.#started ??= this.#open();
    return this.#started;
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
    const listening =
      this.#channels.get(channel.name) ??
      this.#listen(subscriber, channel.name);
    listening.handlers.add(handler as BroadcastHandler<unknown>);
    await listening.subscribed;
  }

  async unsubscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const listening = this.#channels.get(channel.name);
    if (!listening) return;
    listening.handlers.delete(handler as BroadcastHandler<unknown>);
    if (listening.handlers.size > 0) return;
    this.#channels.delete(channel.name);
    await this.#subscriber?.unsubscribe(this.#wire(channel.name));
  }

  override async stop(): Promise<void> {
    const publisher = this.#publisher;
    const subscriber = this.#subscriber;
    const starting = this.#starting;
    const channels = [...this.#channels.keys()];
    this.#publisher = undefined;
    this.#subscriber = undefined;
    this.#started = undefined;
    this.#starting = undefined;
    this.#channels.clear();
    if (starting) {
      starting.abort(new Error('broadcast: stop() was called before ready'));
      publisher?.disconnect();
      subscriber?.disconnect();
      return;
    }
    try {
      if (subscriber?.status === 'ready' && channels.length > 0) {
        await subscriber.unsubscribe(
          ...channels.map((channel) => this.#wire(channel)),
        );
      }
    } finally {
      await this.#close(subscriber);
      await this.#close(publisher);
    }
  }

  // A client that is not ready would queue QUIT until Redis comes back.
  async #close(client: Redis | undefined): Promise<void> {
    if (!client) return;
    if (client.status !== 'ready') {
      client.disconnect();
      return;
    }
    await client.quit().catch((error: unknown) => {
      this.#logger.error(
        error instanceof Error ? error : new Error('broadcast: quit failed'),
      );
    });
  }

  async #open(): Promise<void> {
    const starting = new AbortController();
    const publisher = this.#connect('publisher');
    const subscriber = this.#connect('subscriber');
    this.#starting = starting;
    this.#publisher = publisher;
    this.#subscriber = subscriber;
    subscriber.on('message', (wire: string, raw: string) => {
      void this.#deliver(wire, raw);
    });
    try {
      await Promise.all([
        untilReady(publisher, starting.signal),
        untilReady(subscriber, starting.signal),
      ]);
      starting.signal.throwIfAborted();
    } catch (error) {
      // stop() aborts and closes the clients itself. Otherwise a client ended.
      if (this.#starting === starting) {
        starting.abort(error);
        this.#publisher = undefined;
        this.#subscriber = undefined;
        this.#started = undefined;
        this.#starting = undefined;
        publisher.disconnect();
        subscriber.disconnect();
      }
      throw error;
    }
    this.#starting = undefined;
  }

  #connect(connection: 'publisher' | 'subscriber'): Redis {
    const redis = openRedis(this.#redis);
    redis.on('error', (error: Error) => {
      this.#logger.error(error, { connection });
    });
    return redis;
  }

  #listen(subscriber: Redis, name: string): Listening {
    const handlers = new Set<BroadcastHandler<unknown>>();
    const subscribed = subscriber.subscribe(this.#wire(name)).then(
      () => undefined,
      (error: unknown) => {
        if (this.#channels.get(name)?.handlers === handlers) {
          this.#channels.delete(name);
        }
        throw error;
      },
    );
    const listening = { handlers, subscribed };
    this.#channels.set(name, listening);
    return listening;
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
    const handlers = [...(this.#channels.get(channel)?.handlers ?? [])];
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
