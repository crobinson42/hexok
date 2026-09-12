import type { ApiUseCaseCtor } from '../app/index.js';
import { CodedError } from '../core/index.js';
import { httpStatus } from './http-status.js';
import { type InvokeDeps, invokeApi } from './invoke.js';

export function createFetchHandler(
  apiUseCases: Map<string, ApiUseCaseCtor>,
  deps: InvokeDeps,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.startsWith('/rpc/')) {
      return json(
        { ok: false, error: { code: 'NOT_FOUND', status: 404 } },
        404,
      );
    }
    const key = url.pathname.slice('/rpc/'.length).split('/').join('.');
    const ctor = apiUseCases.get(key);
    if (ctor === undefined) {
      return json(
        { ok: false, error: { code: 'NOT_FOUND', status: 404, message: key } },
        404,
      );
    }
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
    try {
      const ctx = deps.ctxFrom
        ? await deps.ctxFrom({ request, ctx: deps.defaultCtx })
        : deps.defaultCtx;
      const output = await invokeApi(ctor, body.input, deps, {
        ctx,
        request,
      });
      return json({ ok: true, output });
    } catch (error) {
      if (error instanceof CodedError) {
        const status = httpStatus(error.code);
        return json(
          {
            ok: false,
            error: {
              code: error.code,
              status,
              message: error.message,
              ...(error.data !== undefined ? { data: error.data } : {}),
            },
          },
          status,
        );
      }
      throw error;
    }
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
