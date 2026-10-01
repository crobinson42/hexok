import { Adapter, type EventInstance } from 'hexok';
import { BlogEvents } from '../events/catalog.js';
import { EventPublisher } from '../ports/event-publisher.js';
import {
  EventSubscriptions,
  type SubscribedHandler,
} from '../ports/event-subscriptions.js';
import type { RedisClient } from './redis-client.js';

export class RedisEventPublisher extends Adapter(EventPublisher) {
  readonly #redis: RedisClient;

  constructor(redis: RedisClient) {
    super();
    this.#redis = redis;
  }

  override async publish(
    event: EventInstance<typeof BlogEvents>,
  ): Promise<void> {
    await this.#redis.rPush(
      'blog:events',
      JSON.stringify(BlogEvents.message(event)),
    );
  }
}

export class RedisEventSubscriptions extends Adapter(EventSubscriptions) {
  readonly #redis: RedisClient;
  #handlers: SubscribedHandler[] = [];

  constructor(redis: RedisClient) {
    super();
    this.#redis = redis;
  }

  override subscribe(handlers: readonly SubscribedHandler[]): void {
    this.#handlers.push(...handlers);
  }

  async run(): Promise<never> {
    for (;;) {
      const item = await this.#redis.blPop('blog:events', 0);
      if (item === null) continue;
      const event = BlogEvents.parse(JSON.parse(item.element));
      for (const handler of this.#handlers) {
        await handler.handle(event);
      }
    }
  }
}
