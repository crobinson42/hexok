import { type Logger, NoopLogger } from '@hexok/logger';
import { FetchHandler } from '@ts-pf/server-http';
import type { Authenticator } from '../../app/ports/auth/authenticator.js';
import { type ApiApp, callerContext } from '../rpc/app.js';
import { logUnexpected } from '../rpc/errors.js';

/**
 * The API at `/rpc` as one fetch function. srvx, Bun, Deno, Hono, or a test
 * calls it with a `Request`. It reads the caller from the `Authorization`
 * header with `authenticator`.
 */
export function createHttpHandler(
  app: ApiApp,
  options: { authenticator: Authenticator; logger?: Logger },
): (request: Request) => Promise<Response> {
  const onError = logUnexpected(options.logger ?? new NoopLogger());
  const handler = new FetchHandler(app, { onError });
  const caller = callerContext(options.authenticator);
  const context = (request: Request) =>
    caller(request.headers.get('authorization'));

  return async (request) => {
    const result = await handler.handle(request, { prefix: '/rpc', context });
    if (result.matched) return result.response;
    return new Response('Not Found', { status: 404 });
  };
}
