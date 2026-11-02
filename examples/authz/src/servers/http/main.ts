import { serve } from 'srvx';
import { createApi } from '../api.js';
import { createRuntime } from '../composition.js';
import { createApiApp } from '../rpc/app.js';
import { onShutdown } from '../shutdown.js';
import { createHttpHandler } from './handler.js';

const port = portFrom(process.env.PORT);
const runtime = await createRuntime();
const api = createApi(runtime);
const server = serve({
  port,
  fetch: createHttpHandler(createApiApp(api)),
  gracefulShutdown: false,
  silent: true,
});
await server.ready();
console.log(server.url ?? `http://127.0.0.1:${port}`);

onShutdown(async () => {
  await server.close();
});

function portFrom(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error('PORT must be a TCP port.');
  }
  return parsed;
}
