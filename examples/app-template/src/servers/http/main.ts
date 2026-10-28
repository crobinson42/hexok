import { serve } from 'srvx';
import { createApi } from '../api.js';
import { createPublishers, createRuntime } from '../composition.js';
import { createApiApp } from '../rpc/app.js';
import { onShutdown } from '../utils/shutdown.js';
import { createHttpHandler } from './handler.js';

const runtime = await createRuntime();
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
  // onShutdown stops the server and the runtime.
  gracefulShutdown: false,
  silent: true,
});
await server.ready();
runtime.logger.info('http listening', { url: server.url });

onShutdown(runtime.logger, async () => {
  await server.close();
  await runtime.stop();
});
