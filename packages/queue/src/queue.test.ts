import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import {
  assertMaxDeliveries,
  deliveryAllowed,
  dispositionOf,
  Queue,
  type QueueHandler,
  type QueueMessage,
  type QueuePublishOptions,
  type QueueSubscribeOptions,
  retryExhausted,
} from './queue.js';

class MemoryQueue extends Adapter(Queue) {
  readonly published: Array<{ topic: string; payload: unknown }> = [];
  readonly #handlers = new Map<string, QueueHandler<unknown>>();

  /** Cannot delay, so it throws on `delayMs` and on a retry result, as the port requires. */
  async publish(
    topic: string,
    payload: unknown,
    options: QueuePublishOptions = {},
  ): Promise<string> {
    if (options.delayMs) throw new Error('memory queue: cannot delay');
    this.published.push({ topic, payload });
    const id = String(this.published.length);
    const handler = this.#handlers.get(topic);
    if (handler) {
      const message: QueueMessage<unknown> = {
        id,
        topic,
        payload,
        deliveries: 1,
      };
      const returned = await handler(message);
      if (typeof returned === 'object') {
        throw new Error('memory queue: cannot delay a retry');
      }
    }
    return id;
  }

  async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    this.#handlers.set(topic, options.handler as QueueHandler<unknown>);
  }

  async unsubscribe(): Promise<void> {
    this.#handlers.clear();
  }
}

describe('dispositionOf', () => {
  it('acks a returned ack, void, and drop, and retries a throw by default', () => {
    expect(dispositionOf('ack', false)).toBe('ack');
    expect(dispositionOf(undefined, false)).toBe('ack');
    expect(dispositionOf('drop', false)).toBe('drop');
    expect(dispositionOf('retry', false)).toBe('retry');
    expect(dispositionOf(undefined, true)).toBe('retry');
    expect(dispositionOf(undefined, true, 'drop')).toBe('drop');
    expect(dispositionOf('ack', true, 'retry')).toBe('retry');
  });
});

describe('maxDeliveries', () => {
  it('allows a handoff at the ceiling and exhausts a retry there', () => {
    expect(deliveryAllowed(1, 1)).toBe(true);
    expect(deliveryAllowed(2, 5)).toBe(true);
    expect(deliveryAllowed(5, 5)).toBe(true);
    expect(deliveryAllowed(6, 5)).toBe(false);
    expect(deliveryAllowed(100, 'unlimited')).toBe(true);
    expect(retryExhausted(1, 2)).toBe(false);
    expect(retryExhausted(5, 5)).toBe(true);
    expect(retryExhausted(6, 5)).toBe(true);
    expect(retryExhausted(100, 'unlimited')).toBe(false);
  });

  it('rejects a ceiling that is not a positive integer or unlimited', () => {
    expect(() => assertMaxDeliveries(1)).not.toThrow();
    expect(() => assertMaxDeliveries('unlimited')).not.toThrow();
    for (const value of [0, -1, 1.5, Number.NaN, 1e300] as const) {
      expect(() => assertMaxDeliveries(value)).toThrow(
        'queue: maxDeliveries must be a positive integer or "unlimited"',
      );
    }
  });
});

describe('Queue', () => {
  it('runs a handler through the port', async () => {
    const queue = new MemoryQueue();
    const seen: string[] = [];
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 'unlimited',
      handler: async (message) => {
        seen.push(message.id);
        return 'ack';
      },
    });
    await queue.publish('jobs', { id: 'a' });
    expect(seen).toEqual(['1']);
  });
});

describe('Queue options', () => {
  it('types a retry result by the payload, and an adapter that cannot delay throws', async () => {
    const queue = new MemoryQueue();
    await queue.subscribe<{ attempt: number }>('jobs', {
      consumerGroup: 'billing',
      maxDeliveries: 'unlimited',
      concurrency: 4,
      handler: async (message) => ({
        retryInMs: 1000,
        payload: { attempt: message.payload.attempt + 1 },
      }),
    });
    await expect(
      queue.publish('jobs', { attempt: 1 }, { delayMs: 5 }),
    ).rejects.toThrow('memory queue: cannot delay');
    await expect(queue.publish('jobs', { attempt: 1 })).rejects.toThrow(
      'memory queue: cannot delay a retry',
    );
  });
});
