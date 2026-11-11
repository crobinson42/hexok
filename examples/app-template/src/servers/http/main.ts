import { serve } from 'srvx';
import { createApi } from '../api.js';
import { createApiApp } from '../rpc/app.js';
import { createPublishers } from '../runtime/domain-events.js';
import { createRuntime } from '../runtime/index.js';
import { createSessions } from '../runtime/sessions.js';
import { createWebhookUrlChecker } from '../runtime/webhooks.js';
import { onShutdown } from '../utils/shutdown.js';
import { createHttpHandler } from './handler.js';

const runtime = await createRuntime();
// Only HTTP reads tokens, so only HTTP builds sessions. A missing secret fails here, before the server listens.
const { sessions, store: sessionStore } = createSessions({
  env: process.env,
  redisUrl: runtime.redisUrl,
  logger: runtime.logger,
});
// Registered before start, so a signal during startup still stops what has started.
let closeServer: (() => Promise<void>) | undefined;
onShutdown(runtime.logger, async () => {
  await closeServer?.();
  await sessionStore.stop();
  await runtime.stop();
});
await runtime.domainEventsQueue.start();
await sessionStore.start();

const api = createApi({
  posts: runtime.posts,
  subscribers: runtime.subscribers,
  ...createPublishers(runtime),
  checkWebhookUrl: createWebhookUrlChecker(runtime),
});

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: createHttpHandler(createApiApp(api), {
    sessions,
    logger: runtime.logger,
  }),
  gracefulShutdown: false,
  silent: true,
});
closeServer = () => server.close();
await server.ready();
runtime.logger.info('http listening', { url: server.url });
