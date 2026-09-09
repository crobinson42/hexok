import { type ApiUseCaseCtor, rpcPath } from '@plinth/app';
import { CodedError } from '@plinth/core';
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
    const id = url.pathname.slice('/rpc/'.length).split('/').join('.');
    const ctor = apiUseCases.get(id);
    if (ctor === undefined) {
      return json(
        { ok: false, error: { code: 'NOT_FOUND', status: 404, message: id } },
        404,
      );
    }
    let body: { input?: unknown; ctx?: unknown } = {};
    try {
      body = (await request.json()) as { input?: unknown; ctx?: unknown };
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
      const output = await invokeApi(ctor, body.input, deps, {
        ctx: body.ctx ?? deps.defaultCtx,
      });
      return json({ ok: true, output });
    } catch (error) {
      if (error instanceof CodedError) {
        return json(
          {
            ok: false,
            error: {
              code: error.code,
              status: error.status,
              message: error.message,
              ...(error.data !== undefined ? { data: error.data } : {}),
            },
          },
          error.status,
        );
      }
      throw error;
    }
  };
}

export function routePath(id: string): string {
  return rpcPath(id);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
