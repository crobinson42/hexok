import { type Logger, NoopLogger } from '@hexok/logger';
import { FetchHandler } from '@ts-pf/server-http';
import { SseCodec } from '@ts-pf/sse';
import { type ApiApp, callerContext, type EventsApp } from '../rpc/app.js';
import { logUnexpected } from '../rpc/errors.js';

/**
 * One fetch function for both contracts: the API at `/rpc` and client
 * events at `/events` as server-sent events. srvx, Bun, Deno, Hono, or a
 * test calls it with a `Request`.
 */
export function createHttpHandler(
  apps: { api: ApiApp; events: EventsApp },
  options: { logger?: Logger } = {},
): (request: Request) => Promise<Response> {
  const onError = logUnexpected(options.logger ?? new NoopLogger());
  const routes = [
    { prefix: '/rpc', handler: new FetchHandler(apps.api, { onError }) },
    {
      prefix: '/events',
      handler: new FetchHandler(apps.events, {
        onError,
        codec: new SseCodec(),
      }),
    },
  ];
  const context = (request: Request) =>
    callerContext(request.headers.get('authorization'));

  return async (request) => {
    for (const { prefix, handler } of routes) {
      const result = await handler.handle(request, { prefix, context });
      if (result.matched) return result.response;
    }
    return new Response('Not Found', { status: 404 });
  };
}
