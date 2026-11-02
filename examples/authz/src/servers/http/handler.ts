import { FetchHandler } from '@ts-pf/server-http';
import { type ApiApp, actorContext } from '../rpc/app.js';
import { logUnexpected } from '../rpc/errors.js';

/**
 * The API at `/rpc` as one fetch function. srvx, Bun, Deno, Hono, or a test
 * calls it with a `Request`. It reads the actor from the `x-actor` header.
 */
export function createHttpHandler(
  app: ApiApp,
): (request: Request) => Promise<Response> {
  const handler = new FetchHandler(app, { onError: logUnexpected });
  const context = (request: Request) =>
    actorContext(request.headers.get('x-actor'));

  return async (request) => {
    const result = await handler.handle(request, { prefix: '/rpc', context });
    if (result.matched) return result.response;
    return new Response('Not Found', { status: 404 });
  };
}
