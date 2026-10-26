import { describe, expect, it } from 'vitest';
import { ClientEvents } from '../../domain/events/client-events.js';
import { PostPublishedClientEvent } from '../../domain/events/post-published-client.js';
import { ClientSockets } from './client-sockets.js';

const published = new PostPublishedClientEvent({
  postId: 'post-1',
  title: 'Hello',
});

function capture() {
  const messages: unknown[] = [];
  return {
    messages,
    send(text: string) {
      messages.push(JSON.parse(text));
    },
  };
}

describe('ClientSockets', () => {
  it('delivers a catalog event to a client subscribed to all', () => {
    const sockets = new ClientSockets();
    const client = capture();
    sockets.connect(client.send).handle(JSON.stringify({ type: 'subscribe' }));

    sockets.deliver(published);

    expect(client.messages).toEqual([
      { type: 'subscribed', events: ['*'] },
      {
        type: 'event',
        token: 'post.published',
        key: 'postPublished',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
    const frame = client.messages[1];
    expect(frame).toMatchObject({ type: 'event' });
    if (!isEvent(frame)) throw new Error('expected event frame');
    expect(
      ClientEvents.parse({ key: frame.key, payload: frame.payload }),
    ).toBeInstanceOf(PostPublishedClientEvent);
  });

  it('delivers only to the client subscribed to that token', () => {
    const sockets = new ClientSockets();
    const subscribed = capture();
    const idle = capture();
    sockets
      .connect(subscribed.send)
      .handle(
        JSON.stringify({ type: 'subscribe', events: ['post.published'] }),
      );
    sockets.connect(idle.send);

    sockets.deliver(published);

    expect(subscribed.messages).toEqual([
      { type: 'subscribed', events: ['post.published'] },
      {
        type: 'event',
        token: 'post.published',
        key: 'postPublished',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
    expect(idle.messages).toEqual([]);
  });

  it('rejects an unknown token without changing the subscription', () => {
    const sockets = new ClientSockets();
    const client = capture();
    const connection = sockets.connect(client.send);
    connection.handle(
      JSON.stringify({ type: 'subscribe', events: ['post.published'] }),
    );
    connection.handle(JSON.stringify({ type: 'subscribe', events: ['nope'] }));

    sockets.deliver(published);

    expect(client.messages).toEqual([
      { type: 'subscribed', events: ['post.published'] },
      { type: 'error', message: 'unknown event "nope"' },
      {
        type: 'event',
        token: 'post.published',
        key: 'postPublished',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
  });

  it('stops delivering after unsubscribe or close', () => {
    const sockets = new ClientSockets();
    const unsubscribed = capture();
    const closed = capture();
    const unsubscribe = sockets.connect(unsubscribed.send);
    const closing = sockets.connect(closed.send);
    unsubscribe.handle(JSON.stringify({ type: 'subscribe' }));
    closing.handle(JSON.stringify({ type: 'subscribe' }));
    unsubscribe.handle(
      JSON.stringify({ type: 'unsubscribe', events: ['post.published'] }),
    );
    sockets.close(closing);

    sockets.deliver(published);

    expect(unsubscribed.messages.at(-1)).toEqual({
      type: 'subscribed',
      events: [],
    });
    expect(closed.messages.at(-1)).toEqual({
      type: 'subscribed',
      events: ['*'],
    });
  });
});

function isEvent(
  value: unknown,
): value is { type: 'event'; key: string; payload: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'event' &&
    'key' in value &&
    typeof value.key === 'string' &&
    'payload' in value
  );
}
