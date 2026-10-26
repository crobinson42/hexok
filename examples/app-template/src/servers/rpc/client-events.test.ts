import { describe, expect, expectTypeOf, it } from 'vitest';
import { ClientEvents } from '../../domain/events/client-events.js';
import { PostPublishedClientEvent } from '../../domain/events/post-published-client.js';
import { clientEventsChannel } from '../../infra/events/broadcasters/client-events-channel.js';
import { MemoryBroadcast } from '../../infra/events/broadcasters/memory-broadcast.js';
import {
  type ClientEventMessage,
  clientEventKeys,
  clientEventStream,
} from './client-events.js';

const message = ClientEvents.message(
  new PostPublishedClientEvent({ postId: 'post-1', title: 'Hello' }),
);

describe('clientEventKeys', () => {
  it('reads the keys from the catalog', () => {
    expect(clientEventKeys).toEqual(['postPublished']);
  });

  it('narrows the payload by key', () => {
    const narrow = (event: ClientEventMessage) => {
      if (event.key === 'postPublished') {
        expectTypeOf(event.payload).toEqualTypeOf<{
          postId: string;
          title: string;
        }>();
      }
    };
    void narrow;
  });
});

describe('clientEventStream', () => {
  it('yields the messages published after the call', async () => {
    const broadcast = new MemoryBroadcast();
    const events = clientEventStream(broadcast);

    await broadcast.publish(clientEventsChannel, message);

    expect(await events.next()).toEqual({ done: false, value: message });
    await events.return?.();
  });

  it('yields only the requested keys', async () => {
    const broadcast = new MemoryBroadcast();
    const none = clientEventStream(broadcast, []);
    const pending = none.next();

    await broadcast.publish(clientEventsChannel, message);
    await none.return?.();

    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it('drops a message the catalog rejects', async () => {
    const broadcast = new MemoryBroadcast();
    const events = clientEventStream(broadcast);

    await expect(
      broadcast.publish(clientEventsChannel, {
        key: 'postPublished',
        payload: { postId: '' },
      } as unknown as ClientEventMessage),
    ).rejects.toThrow();
    await broadcast.publish(clientEventsChannel, message);

    expect(await events.next()).toEqual({ done: false, value: message });
    await events.return?.();
  });

  it('unsubscribes when the reader stops, even mid-read', async () => {
    const broadcast = new MemoryBroadcast();
    const events = clientEventStream(broadcast);
    const pending = events.next();
    expect(broadcast.count(clientEventsChannel)).toBe(1);

    await events.return?.();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(broadcast.count(clientEventsChannel)).toBe(0);
  });
});
