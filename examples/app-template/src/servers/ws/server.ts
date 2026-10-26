import type { IncomingMessage, Server } from 'node:http';
import { setInterval } from 'node:timers';
import { type Logger, NoopLogger } from '@hexok/logger';
import { type WebSocketLike, WsHandler } from '@ts-pf/message-server';
import type { ImplementedRouter } from '@ts-pf/server';
import { type ServerOptions, type WebSocket, WebSocketServer } from 'ws';
import { logUnexpected } from '../rpc/errors.js';

/**
 * `ws` takes npm `ws` server options: `{ port }`, `{ server }` to share an
 * HTTP port with one websocket server, or `{ noServer: true }` for
 * {@link routeUpgrades}. `ws.verifyClient` can refuse an upgrade before it
 * becomes a socket.
 */
export type WsServerOptions<Ctx> = {
  ws: ServerOptions;
  /**
   * The connection's context. Runs once, on the client's hello. `req` is the
   * upgrade request. `meta` is what the client sent with
   * `new WsLink({ url, meta })`. A browser cannot set websocket headers, so it
   * sends a token in `meta`. `meta` is untrusted JSON. A throw ends the
   * handshake: the client receives a hello error and the socket closes.
   */
  context(connection: {
    req: IncomingMessage;
    meta: unknown;
  }): Ctx | Promise<Ctx>;
  logger?: Logger;
  /** Interval for ping. A socket that misses a pong is terminated. */
  pingMs?: number;
};

export type WsServer = {
  readonly wss: WebSocketServer;
  /** Stop accepting, terminate every socket, and stop the ping timer. */
  close(): Promise<void>;
};

/**
 * Serve a ts-pf app over npm `ws`. ts-pf runs the protocol on each socket.
 * This adds the context and a heartbeat.
 */
export function createWsServer<Ctx>(
  app: ImplementedRouter<unknown, Ctx>,
  options: WsServerOptions<Ctx>,
): WsServer {
  const { logger = new NoopLogger(), pingMs = 30_000 } = options;
  const handler = new WsHandler(app, { onError: logUnexpected(logger) });
  const wss = new WebSocketServer(options.ws);
  const alive = new WeakSet<WebSocket>();

  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, pingMs);
  timer.unref();

  wss.on('connection', (socket, req) => {
    alive.add(socket);
    socket.on('pong', () => {
      alive.add(socket);
    });
    socket.on('error', (error) => {
      logger.warn(error.message);
    });
    // npm `ws` 8 works at runtime, but its listener type is wider than
    // `WebSocketLike` declares.
    handler.bind(socket as unknown as WebSocketLike, {
      context: ({ meta }) => options.context({ req, meta }),
    });
  });

  return {
    wss,
    async close() {
      clearInterval(timer);
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/**
 * Serve several websocket servers on one HTTP server, one per path. Create
 * each with `ws: { noServer: true }`. npm `ws` answers 400 to an upgrade
 * whose path it does not own, so two servers given `{ server, path }` on one
 * HTTP server refuse each other's clients. An unknown path gets 404.
 */
export function routeUpgrades(
  server: Server,
  routes: Record<string, WsServer>,
): void {
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const route = Object.hasOwn(routes, pathname)
      ? routes[pathname]
      : undefined;
    if (route === undefined) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    route.wss.handleUpgrade(req, socket, head, (ws) => {
      route.wss.emit('connection', ws, req);
    });
  });
}
