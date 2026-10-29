import type { QueueHandler, QueueSubscribeOptions } from '@hexok/queue';
import { Queue } from '@hexok/queue';
import { Adapter, EventHandler } from 'hexok';
import { describe, expect, it } from 'vitest';
import { PostPublishedEvent } from '../../domain/events/post-published.js';
import { PostUnpublishedEvent } from '../../domain/events/post-unpublished.js';
import {
  assertDistinctHandlerGroups,
  deliver,
  subscribeHandler,
} from './subscribe-handler.js';

const payload = {
  postId: 'post-1',
  title: 'Hello',
  emailSubscribers: true,
};

class CountingHandler extends EventHandler(
  'count.published',
  PostPublishedEvent,
) {
  calls = 0;
  handle(event: PostPublishedEvent): void {
    this.calls += 1;
    expect(event.payload.postId).toBe('post-1');
  }
}

class ThrowingHandler extends EventHandler(
  'throw.published',
  PostPublishedEvent,
) {
  handle(_event: PostPublishedEvent): void {
    throw new Error('handler failed');
  }
}

class GroupedHandler extends EventHandler(
  'grouped.published',
  PostPublishedEvent,
) {
  static readonly group = 'shared';
  handle(_event: PostPublishedEvent): void {}
}

class MemoryQueue extends Adapter(Queue) {
  readonly subscriptions: Array<{
    topic: string;
    consumerGroup: string;
    maxDeliveries: QueueSubscribeOptions<unknown>['maxDeliveries'];
    handler: QueueHandler<unknown>;
  }> = [];

  async publish(): Promise<string> {
    return '1';
  }

  async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    this.subscriptions.push({
      topic,
      consumerGroup: options.consumerGroup,
      maxDeliveries: options.maxDeliveries,
      handler: options.handler as QueueHandler<unknown>,
    });
  }

  async unsubscribe(): Promise<void> {
    this.subscriptions.length = 0;
  }
}

describe('subscribeHandler', () => {
  it('subscribes the event token and defaults the group to the handler token', async () => {
    const queue = new MemoryQueue();
    const handler = new CountingHandler();
    const subscription = await subscribeHandler(queue, handler, {
      maxDeliveries: 20,
    });
    expect(subscription).toEqual({
      topic: 'post.published',
      group: 'count.published',
    });
    expect(queue.subscriptions).toEqual([
      expect.objectContaining({
        topic: 'post.published',
        consumerGroup: 'count.published',
        maxDeliveries: 20,
      }),
    ]);
  });

  it('uses a static group when the handler class sets one', async () => {
    const queue = new MemoryQueue();
    const subscription = await subscribeHandler(queue, new GroupedHandler(), {
      maxDeliveries: 'unlimited',
    });
    expect(subscription.group).toBe('shared');
  });
});

describe('assertDistinctHandlerGroups', () => {
  it('throws when two classes share a topic and group', () => {
    class First extends EventHandler('email.subscribers', PostPublishedEvent) {
      handle(_event: PostPublishedEvent): void {}
    }
    class Second extends EventHandler('email.subscribers', PostPublishedEvent) {
      handle(_event: PostPublishedEvent): void {}
    }
    expect(() =>
      assertDistinctHandlerGroups([new First(), new Second()]),
    ).toThrow(
      'First (email.subscribers) and Second (email.subscribers) both consume topic "post.published" group "email.subscribers"',
    );
  });

  it('throws when two classes set the same static group on one event', () => {
    class First extends EventHandler('email.subscribers', PostPublishedEvent) {
      static readonly group = 'shared';
      handle(_event: PostPublishedEvent): void {}
    }
    class Second extends EventHandler(
      'analytics.published',
      PostPublishedEvent,
    ) {
      static readonly group = 'shared';
      handle(_event: PostPublishedEvent): void {}
    }
    expect(() =>
      assertDistinctHandlerGroups([new First(), new Second()]),
    ).toThrow(/topic "post\.published" group "shared"/);
  });

  it('allows different groups on one event and the same group on different events', () => {
    class Published extends EventHandler(
      'email.subscribers',
      PostPublishedEvent,
    ) {
      static readonly group = 'shared';
      handle(_event: PostPublishedEvent): void {}
    }
    class OtherPublished extends EventHandler(
      'analytics.published',
      PostPublishedEvent,
    ) {
      handle(_event: PostPublishedEvent): void {}
    }
    class Unpublished extends EventHandler(
      'email.unpublished',
      PostUnpublishedEvent,
    ) {
      static readonly group = 'shared';
      handle(_event: PostUnpublishedEvent): void {}
    }
    expect(() =>
      assertDistinctHandlerGroups([
        new Published(),
        new OtherPublished(),
        new Unpublished(),
        new Published(),
      ]),
    ).not.toThrow();
  });
});

describe('deliver', () => {
  it('acks a valid payload and calls handle', async () => {
    const handler = new CountingHandler();
    await expect(deliver(handler, payload)).resolves.toBe('ack');
    expect(handler.calls).toBe(1);
  });

  it('drops a payload the event schema rejects', async () => {
    const handler = new CountingHandler();
    await expect(deliver(handler, { postId: 1 })).resolves.toBe('drop');
    expect(handler.calls).toBe(0);
  });

  it('lets a handler throw so the queue can retry', async () => {
    await expect(deliver(new ThrowingHandler(), payload)).rejects.toThrow(
      'handler failed',
    );
  });
});
