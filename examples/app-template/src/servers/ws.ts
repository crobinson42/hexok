import { setInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { ClientEvents } from '../domain/events/client-events.js';
import { clientEventsChannel } from '../infra/events/broadcasters/client-events-channel.js';
import { createRuntime } from './composition.js';
import { ClientSockets } from './utils/client-sockets.js';

const PING_MS = 30_000;

export async function main(): Promise<void> {
  const runtime = await createRuntime();
  await runtime.clientEventsBroadcast.start();

  const sockets = new ClientSockets();
  await runtime.clientEventsBroadcast.subscribe(
    clientEventsChannel,
    (message) => {
      try {
        sockets.deliver(ClientEvents.parse(message.payload));
      } catch (error) {
        runtime.logger.error(
          error instanceof Error ? error : 'client event parse failed',
        );
      }
    },
  );

  const port = Number(process.env.WS_PORT ?? 3001);
  const server = new WebSocketServer({ port });
  const alive = new WeakSet<WebSocket>();

  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, PING_MS);
  timer.unref();

  server.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => {
      alive.add(socket);
    });
    const client = sockets.connect((text) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(text);
    });
    socket.on('message', (data, isBinary) => {
      try {
        if (isBinary) {
          client.fail('expected text');
          return;
        }
        client.handle(textOf(data));
      } catch (error) {
        runtime.logger.error(
          error instanceof Error ? error : 'client message failed',
        );
        sockets.close(client);
      }
    });
    socket.on('close', () => {
      sockets.close(client);
    });
    socket.on('error', (error) => {
      runtime.logger.warn(
        error instanceof Error ? error.message : 'client socket failed',
      );
      sockets.close(client);
    });
  });

  runtime.logger.info('client events websocket', { port });
}

function textOf(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
