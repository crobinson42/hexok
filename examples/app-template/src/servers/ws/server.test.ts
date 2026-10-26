import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asResult, createClient } from '@ts-pf/client';
import { WsLink } from '@ts-pf/message-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ApiCtx } from '../../app/use-cases/context.js';
import { ClientEvents } from '../../domain/events/client-events.js';
import { PostPublishedClientEvent } from '../../domain/events/post-published-client.js';
import { clientEventsChannel } from '../../infra/events/broadcasters/client-events-channel.js';
import { MemoryBroadcast } from '../../infra/events/broadcasters/memory-broadcast.js';
import { createEventsApp } from '../rpc/app.js';
import type { eventsContract } from '../rpc/contract.js';
import { createWsServer, routeUpgrades, type WsServer } from './server.js';

const message = ClientEvents.message(
  new PostPublishedClientEvent({ postId: 'post-1', title: 'Hello' }),
);

const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** Serve the events app on a free port. */
async function serveEvents(
  broadcast: MemoryBroadcast,
  context = (_connection: {
    req: IncomingMessage;
    meta: unknown;
  }): ApiCtx => ({}),
): Promise<string> {
  const server: WsServer = createWsServer(createEventsApp(broadcast), {
    ws: { port: 0 },
    context,
  });
  cleanup.push(() => server.close());
  await once(server.wss, 'listening');
  const { port } = server.wss.address() as AddressInfo;
  return `ws://127.0.0.1:${port}`;
}

function connect(url: string, meta?: unknown) {
  const link = new WsLink(meta === undefined ? { url } : { url, meta });
  cleanup.push(() => link.close());
  return createClient<typeof eventsContract>(link);
}

/** Wait until the channel has `count` handlers, so a publish is not missed. */
function subscribers(broadcast: MemoryBroadcast, count: number) {
  return vi.waitFor(() =>
    expect(broadcast.count(clientEventsChannel)).toBe(count),
  );
}

describe('createWsServer', () => {
  it('streams client events to a ts-pf client', async () => {
    const broadcast = new MemoryBroadcast();
    const client = connect(await serveEvents(broadcast));

    // The call resolves with the first event, so publish before awaiting it.
    const events = client.subscribe({ events: ['postPublished'] });
    await subscribers(broadcast, 1);
    await broadcast.publish(clientEventsChannel, message);

    for await (const event of await events) {
      expect(event).toEqual(message);
      break;
    }
  });

  it('unsubscribes when the client cancels', async () => {
    const broadcast = new MemoryBroadcast();
    const client = connect(await serveEvents(broadcast));
    const controller = new AbortController();

    const call = asResult(client.subscribe({}, { signal: controller.signal }));
    await subscribers(broadcast, 1);
    controller.abort();

    await subscribers(broadcast, 0);
    expect((await call).ok).toBe(false);
  });

  it('rejects a key the catalog does not have', async () => {
    const client = connect(await serveEvents(new MemoryBroadcast()));

    const result = await asResult(
      // @ts-expect-error 'nope' is not a key in the catalog
      client.subscribe({ events: ['nope'] }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('passes the upgrade request and hello meta to context', async () => {
    const seen: Array<{ url: string | undefined; meta: unknown }> = [];
    const url = await serveEvents(new MemoryBroadcast(), ({ req, meta }) => {
      seen.push({ url: req.url, meta });
      return {};
    });
    const client = connect(`${url}/?room=1`, { token: 'ada' });
    const controller = new AbortController();

    const call = asResult(client.subscribe({}, { signal: controller.signal }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    controller.abort();
    await call;

    expect(seen).toEqual([{ url: '/?room=1', meta: { token: 'ada' } }]);
  });

  it('ends the handshake when context throws', async () => {
    const url = await serveEvents(new MemoryBroadcast(), () => {
      throw new Error('no token');
    });

    const result = await asResult(connect(url).subscribe({}));

    // ts-pf sends a hello error without the thrown message.
    expect(result.ok ? undefined : result.error.code).toBe('INTERNAL');
  });
});

describe('routeUpgrades', () => {
  it('serves each websocket server on its own path of one port', async () => {
    const http = createServer();
    const open = new MemoryBroadcast();
    const account = new MemoryBroadcast();
    const servers = [open, account].map((broadcast) =>
      createWsServer(createEventsApp(broadcast), {
        ws: { noServer: true },
        context: () => ({}),
      }),
    );
    const [openServer, accountServer] = servers as [WsServer, WsServer];
    routeUpgrades(http, { '/ws': openServer, '/ws/account': accountServer });
    cleanup.push(
      () => new Promise((resolve) => http.close(resolve)),
      ...servers.map((server) => () => server.close()),
    );
    http.listen(0);
    await once(http, 'listening');
    const { port } = http.address() as AddressInfo;

    const events = connect(`ws://127.0.0.1:${port}/ws/account`).subscribe({});
    await subscribers(account, 1);
    expect(open.count(clientEventsChannel)).toBe(0);
    await account.publish(clientEventsChannel, message);

    for await (const event of await events) {
      expect(event).toEqual(message);
      break;
    }
  });

  it('answers an unknown path with 404', async () => {
    const http = createServer();
    routeUpgrades(http, {});
    cleanup.push(() => new Promise((resolve) => http.close(resolve)));
    http.listen(0);
    await once(http, 'listening');
    const { port } = http.address() as AddressInfo;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/nope`);
    const [error] = (await once(socket, 'error')) as [Error];

    expect(error.message).toContain('404');
  });
});
