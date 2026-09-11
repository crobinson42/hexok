import { describe, expect, it } from 'vitest';
import type { Actor } from '../domain/schemas/actor.js';
import {
  type ClientConnection,
  WebSocketChannel,
} from '../infra/client-event-bus/index.js';
import { createApi } from './index.js';
import { stubToken } from './stubs.js';

function fakeSocket() {
  const listeners = new Set<() => void>();
  const sent: string[] = [];
  let closed = false;
  const socket: ClientConnection & { sent: string[]; closed: boolean } = {
    sent,
    get closed() {
      return closed;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      closed = true;
      for (const listener of listeners) listener();
    },
    addEventListener(type: 'close', listener: () => void) {
      if (type === 'close') listeners.add(listener);
    },
  };
  return socket;
}

function messages(socket: { sent: string[] }) {
  return socket.sent.map((row) => JSON.parse(row) as Record<string, unknown>);
}

const actor: Actor = {
  type: 'user',
  userId: 'u1',
  organizationIds: ['org-1'],
};

describe('WebSocketChannel', () => {
  it('drops a socket after close', () => {
    const channel = WebSocketChannel.create<Actor>();
    const socket = fakeSocket();
    channel.join('c1', actor, socket);
    socket.close();
    expect(channel.list()).toEqual([]);
  });
});

describe('createApi websockets', () => {
  it('rejects a socket without a token', async () => {
    const { accept } = createApi();
    const socket = fakeSocket();
    await accept(socket, new Request('http://app/ws'));
    expect(socket.closed).toBe(true);
  });

  it('pushes client events from use-cases', async () => {
    const { app, accept, clientBus } = createApi();
    await app.start();
    const registered = await app.local.organization.register({
      organization: { id: 'org-1', name: 'Acme' },
      user: {
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com',
      },
    });

    const token = await stubToken().issue(actor);
    const member = fakeSocket();
    const outsider = fakeSocket();
    await accept(
      member,
      new Request('http://app/ws', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    await accept(
      outsider,
      new Request(
        `http://app/ws?token=${await stubToken().issue({
          type: 'user',
          userId: 'u2',
          organizationIds: ['org-2'],
        })}`,
      ),
    );

    await app.local.apiKey.create(
      {
        id: 'k1',
        userId: 'u1',
        key: 'secret',
        organizationIds: ['org-1'],
      },
      { ctx: { actor } },
    );

    expect(registered.organization.id).toBe('org-1');
    expect(
      clientBus.published
        .filter((envelope) => envelope.catalog === 'client')
        .map((envelope) => envelope.key),
    ).toEqual(['organization.created', 'user.created', 'apiKey.created']);

    expect(messages(member)).toEqual([
      expect.objectContaining({
        catalog: 'client',
        key: 'apiKey.created',
        payload: {
          id: 'k1',
          userId: 'u1',
          organizationIds: ['org-1'],
        },
      }),
    ]);
    expect(messages(member)[0]).not.toHaveProperty('ctx');
    expect(outsider.sent).toEqual([]);
    await app.stop();
  });
});
