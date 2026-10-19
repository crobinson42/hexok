import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { Broadcast, type BroadcastHandler } from './broadcast.js';

class MemoryBroadcast extends Adapter(Broadcast) {
  readonly handlers = new Map<string, Set<BroadcastHandler<unknown>>>();

  async publish(channel: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;
    for (const handler of handlers) {
      await Promise.resolve(handler({ channel, payload }));
    }
  }

  async subscribe<T>(
    channel: string,
    handler: BroadcastHandler<T>,
  ): Promise<void> {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler as BroadcastHandler<unknown>);
    this.handlers.set(channel, set);
  }

  async unsubscribe(
    channel: string,
    handler: BroadcastHandler<unknown>,
  ): Promise<void> {
    this.handlers.get(channel)?.delete(handler);
  }
}

describe('Broadcast', () => {
  it('delivers to a subscriber and ignores a thrown sibling', async () => {
    const bus = new MemoryBroadcast();
    const seen: string[] = [];
    await bus.subscribe('news', () => {
      throw new Error('nope');
    });
    await bus.subscribe('news', (message) => {
      seen.push(String(message.payload));
    });
    await expect(bus.publish('news', 'hi')).rejects.toThrow('nope');
    expect(seen).toEqual([]);
  });
});
