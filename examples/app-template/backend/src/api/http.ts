import { CodedError } from 'hexok/core';
import type { AppContext } from '../app/context.js';
import type { AuthTokenService } from '../app/ports/services/auth-token.js';

export const publicRoutes = new Set([
  'auth.login',
  'auth.authenticateApiKey',
  'organization.register',
  'user.setupCredentials',
]);

export function createHandler(app: {
  router: { fetch: (request: Request) => Promise<Response> };
}): (request: Request) => Promise<Response> {
  return (request) => app.router.fetch(request);
}

export async function contextFromRequest(
  key: string,
  request: Request,
  token: AuthTokenService,
  ctx: AppContext,
): Promise<AppContext> {
  if (publicRoutes.has(key)) return ctx;

  const header = request.headers.get('authorization') ?? '';
  const raw = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  const actor = raw ? await token.verify(raw) : null;
  if (!actor) {
    throw new CodedError({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  }
  return { ...ctx, actor };
}

export function rpcKeyFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.pathname.slice('/rpc/'.length).split('/').join('.');
}
