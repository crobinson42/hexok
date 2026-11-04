import { serve } from 'srvx';
import { createApi } from '../api.js';
import { createPublishers, createRuntime } from '../composition.js';
import { createApiApp } from '../rpc/app.js';
import { onShutdown } from '../utils/shutdown.js';
import { createHttpHandler } from './handler.js';

const runtime = await createRuntime();
// Registered before start, so a signal during startup still stops what has started.
let closeServer: (() => Promise<void>) | undefined;
onShutdown(runtime.logger, async () => {
  await closeServer?.();
  await runtime.stop();
});
await runtime.domainEventsQueue.start();

const api = createApi({
  posts: runtime.posts,
  subscribers: runtime.subscribers,
  ...createPublishers(runtime),
  authenticator: runtime.authenticator,
});

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: createHttpHandler(createApiApp(api), {
    authenticator: runtime.authenticator,
    logger: runtime.logger,
  }),
  gracefulShutdown: false,
  silent: true,
});
closeServer = () => server.close();
await server.ready();
runtime.logger.info('http listening', { url: server.url });
