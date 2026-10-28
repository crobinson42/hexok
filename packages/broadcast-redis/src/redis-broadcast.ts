import {
  Broadcast,
  type BroadcastHandler,
  type Channel,
} from '@hexok/broadcast';
import {
  type LogSink,
  openRedis,
  RedisLifecycle,
} from '@hexok/ioredis-lifecycle';
import { Adapter } from 'hexok';
import type { Redis, RedisOptions } from 'ioredis';
import { decodeJson, encodeJson } from './codec.js';

export interface RedisBroadcastConfig {
  readonly redis: string | RedisOptions;
  readonly channelPrefix?: string;
  readonly encode?: (payload: unknown) => string;
  readonly decode?: (raw: string) => unknown;
  readonly logger?: LogSink;
  /**
   * The total time `stop()` may take. Default 1000.
   * Pub/sub holds no state to drain, so stop only needs time for `QUIT`.
   */
  readonly stopTimeoutMs?: number;
  /** Rejects `start()` with `StartTimeout` when Redis is not ready in time. Unset, `start()` waits for Redis. */
  readonly startTimeoutMs?: number;
}

const ADAPTER = 'broadcast';

interface Clients extends Record<string, Redis> {
  publisher: Redis;
  subscriber: Redis;
}

interface Listening {
  readonly handlers: Set<BroadcastHandler<unknown>>;
  /** The channel's one `SUBSCRIBE`. A later `subscribe` to the channel awaits it. */
  readonly subscribed: Promise<void>;
}

export class RedisBroadcast extends Adapter(Broadcast) {
  readonly #redis: string | RedisOptions;
  readonly #channelPrefix: string;
  readonly #encode: (payload: unknown) => string;
  readonly #decode: (raw: string) => unknown;
  readonly #logger: LogSink | undefined;
  readonly #lifecycle: RedisLifecycle<Clients>;
  readonly #channels = new Map<string, Listening>();

  constructor(config: RedisBroadcastConfig) {
    super();
    this.#redis = config.redis;
    this.#channelPrefix = config.channelPrefix ?? 'hexok:broadcast:';
    this.#encode = config.encode ?? encodeJson;
    this.#decode = config.decode ?? decodeJson;
    this.#logger = config.logger;
    this.#lifecycle = new RedisLifecycle({
      adapter: ADAPTER,
      stopTimeoutMs: config.stopTimeoutMs ?? 1000,
      startTimeoutMs: config.startTimeoutMs,
      logger: this.#logger,
    });
  }

  start(): Promise<void> {
    return this.#lifecycle.start(() => {
      const publisher = openRedis(this.#redis);
      const subscriber = openRedis(this.#redis);
      subscriber.on('message', (wire: string, raw: string) => {
        void this.#deliver(wire, raw);
      });
      return { publisher, subscriber };
    });
  }

  async publish<Name extends string, T>(
    channel: Channel<Name, T>,
    payload: T,
  ): Promise<void> {
    // Encoding inside the command lets a state error win, and a failed encode never sends PUBLISH.
    await this.#lifecycle.run('publish', ({ publisher }) =>
      publisher.publish(this.#wire(channel.name), this.#encode(payload)),
    );
  }

  async subscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const listening =
      this.#channels.get(channel.name) ?? this.#listen(channel.name);
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
    // run() sends UNSUBSCRIBE synchronously, so it follows any SUBSCRIBE already sent for the channel.
    await this.#lifecycle.run('unsubscribe', ({ subscriber }) =>
      subscriber.unsubscribe(this.#wire(channel.name)),
    );
  }

  /** Sends no `UNSUBSCRIBE`. `QUIT` ends the subscriptions, and a dead Redis would never answer it. */
  override stop(): Promise<void> {
    this.#channels.clear();
    return this.#lifecycle.stop();
  }

  #listen(name: string): Listening {
    const handlers = new Set<BroadcastHandler<unknown>>();
    const subscribed = this.#lifecycle
      .run('subscribe', ({ subscriber }) =>
        subscriber.subscribe(this.#wire(name)),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          // An unsubscribe and a new subscribe may have replaced this entry. Keep theirs.
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
    const fields = { adapter: ADAPTER, connection: 'subscriber', channel };
    let payload: unknown;
    try {
      payload = this.#decode(raw);
    } catch (error) {
      this.#logger?.error(
        error instanceof Error ? error : new Error('broadcast: decode failed'),
        fields,
      );
      return;
    }
    const handlers = [...(this.#channels.get(channel)?.handlers ?? [])];
    for (const handler of handlers) {
      try {
        await Promise.resolve(handler({ channel, payload }));
      } catch (error) {
        this.#logger?.error(
          error instanceof Error
            ? error
            : new Error('broadcast: handler failed'),
          fields,
        );
      }
    }
  }

  #wire(channel: string): string {
    return `${this.#channelPrefix}${channel}`;
  }
}
