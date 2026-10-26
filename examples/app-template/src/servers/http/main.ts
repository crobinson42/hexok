import { serve } from 'srvx';
import { createApi } from '../api.js';
import { createPublishers, createRuntime } from '../composition.js';
import { createApiApp, createEventsApp } from '../rpc/app.js';
import { onShutdown } from '../utils/shutdown.js';
import { createHttpHandler } from './handler.js';

const runtime = await createRuntime();
await runtime.domainEventsQueue.start();
await runtime.clientEventsBroadcast.start();

const api = createApi({
  posts: runtime.posts,
  subscribers: runtime.subscribers,
  ...createPublishers(runtime),
});

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: createHttpHandler(
    {
      api: createApiApp(api),
      events: createEventsApp(runtime.clientEventsBroadcast),
    },
    { logger: runtime.logger },
  ),
  // onShutdown stops the server and the runtime.
  gracefulShutdown: false,
  silent: true,
});
await server.ready();
runtime.logger.info('http listening', { url: server.url });

onShutdown(runtime.logger, async () => {
  // Event streams stay open, so close them instead of waiting.
  await server.close(true);
  await runtime.stop();
});
