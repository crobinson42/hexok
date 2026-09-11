import type { AppContext } from '../app/context.js';
import type { AuthTokenService } from '../app/ports/services/authTokenService.js';

export const publicRoutes = new Set([
  'auth.login',
  'auth.authenticateApiKey',
  'organization.register',
  'user.setupCredentials',
]);

export function createHandler(
  app: { router: { fetch: (request: Request) => Promise<Response> } },
  token: AuthTokenService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.startsWith('/rpc/')) {
      return app.router.fetch(request);
    }

    const key = url.pathname.slice('/rpc/'.length).split('/').join('.');

    let body: { input?: unknown } = {};
    try {
      body = (await request.json()) as { input?: unknown };
    } catch {
      return json(
        {
          ok: false,
          error: { code: 'VALIDATION', status: 400, message: 'Invalid JSON' },
        },
        400,
      );
    }

    const ctx = await contextFromRequest(key, request, token);
    if (ctx === null) {
      return json(
        {
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            status: 401,
            message: 'Unauthorized',
          },
        },
        401,
      );
    }

    return app.router.fetch(
      new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: body.input, ctx }),
      }),
    );
  };
}

async function contextFromRequest(
  key: string,
  request: Request,
  token: AuthTokenService,
): Promise<AppContext | null> {
  if (publicRoutes.has(key)) return {};

  const header = request.headers.get('authorization') ?? '';
  const raw = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  const actor = raw ? await token.verify(raw) : null;
  if (!actor) return null;
  return { actor };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
