import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import {
  Broadcast,
  type BroadcastHandler,
  type Channel,
  channel,
} from './broadcast.js';

class MemoryBroadcast extends Adapter(Broadcast) {
  readonly handlers = new Map<string, Set<BroadcastHandler<unknown>>>();

  async publish<Name extends string, T>(
    bus: Channel<Name, T>,
    payload: T,
  ): Promise<void> {
    const handlers = this.handlers.get(bus.name);
    if (!handlers) return;
    for (const handler of handlers) {
      await Promise.resolve(handler({ channel: bus.name, payload }));
    }
  }

  async subscribe<Name extends string, T>(
    bus: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const set = this.handlers.get(bus.name) ?? new Set();
    set.add(handler as BroadcastHandler<unknown>);
    this.handlers.set(bus.name, set);
  }

  async unsubscribe<Name extends string, T>(
    bus: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    this.handlers.get(bus.name)?.delete(handler as BroadcastHandler<unknown>);
  }
}

describe('Broadcast', () => {
  it('delivers to a subscriber and ignores a thrown sibling', async () => {
    const bus = new MemoryBroadcast();
    const news = channel<string>('news');
    const seen: string[] = [];
    await bus.subscribe(news, () => {
      throw new Error('nope');
    });
    await bus.subscribe(news, (message) => {
      seen.push(message.payload);
    });
    await expect(bus.publish(news, 'hi')).rejects.toThrow('nope');
    expect(seen).toEqual([]);
  });
});
