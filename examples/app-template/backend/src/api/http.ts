import { CodedError } from 'hexok/core';
import type { AppContext } from '../app/context.js';
import { AuthErrors } from '../app/errors.js';
import type { AuthTokenService } from '../app/ports/services/auth-token.js';

export function createHandler(app: {
  router: { fetch: (request: Request) => Promise<Response> };
}): (request: Request) => Promise<Response> {
  return (request) => app.router.fetch(request);
}

/** Best-effort identity. Missing or empty Bearer leaves `actor` unset. A non-empty token that fails verify throws. */
export async function contextFromRequest(
  request: Request,
  token: AuthTokenService,
  ctx: AppContext,
): Promise<AppContext> {
  const header = request.headers.get('authorization') ?? '';
  const raw = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  if (!raw) return ctx;
  const actor = await token.verify(raw);
  if (!actor) {
    throw new CodedError({
      code: 'UNAUTHORIZED',
      message: AuthErrors.UNAUTHORIZED.message,
    });
  }
  return { ...ctx, actor };
}
