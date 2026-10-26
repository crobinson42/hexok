import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import {
  dispositionOf,
  Queue,
  type QueueHandler,
  type QueueMessage,
} from './queue.js';

class MemoryQueue extends Adapter(Queue) {
  readonly published: Array<{ topic: string; payload: unknown }> = [];
  readonly #handlers = new Map<string, QueueHandler<unknown>>();

  async publish(topic: string, payload: unknown): Promise<string> {
    this.published.push({ topic, payload });
    const id = String(this.published.length);
    const handler = this.#handlers.get(topic);
    if (handler) {
      const message: QueueMessage<unknown> = { id, topic, payload };
      await handler(message);
    }
    return id;
  }

  async subscribe<T>(
    topic: string,
    options: { consumerGroup: string; handler: QueueHandler<T> },
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

describe('Queue', () => {
  it('runs a handler through the port', async () => {
    const queue = new MemoryQueue();
    const seen: string[] = [];
    await queue.subscribe('jobs', {
      consumerGroup: 'billing',
      handler: async (message) => {
        seen.push(message.id);
        return 'ack';
      },
    });
    await queue.publish('jobs', { id: 'a' });
    expect(seen).toEqual(['1']);
  });
});
