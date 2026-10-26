import { createRuntime } from '../composition.js';
import { callerContext, createEventsApp } from '../rpc/app.js';
import { onShutdown } from '../utils/shutdown.js';
import { createWsServer } from './server.js';

const runtime = await createRuntime();
await runtime.clientEventsBroadcast.start();

const port = Number(process.env.WS_PORT ?? 3001);
const server = createWsServer(createEventsApp(runtime.clientEventsBroadcast), {
  ws: { port },
  // A server client sends the header. A browser sends `meta: { token }`.
  context: ({ req, meta }) =>
    callerContext(req.headers.authorization ?? metaToken(meta)),
  logger: runtime.logger,
});
server.wss.on('listening', () => {
  runtime.logger.info('websocket listening', { port });
});

onShutdown(runtime.logger, async () => {
  await server.close();
  await runtime.stop();
});

function metaToken(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null || !('token' in meta)) {
    return undefined;
  }
  return typeof meta.token === 'string' ? meta.token : undefined;
}
