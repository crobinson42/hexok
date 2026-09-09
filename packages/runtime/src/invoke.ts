import {
  type ApiUseCaseCtor,
  type EventUseCaseCtor,
  errorFactories,
  type Publish,
  type UseCaseClass,
} from '@plinth/app';
import { CodedError, type Infer, validate } from '@plinth/core';
import type {
  Envelope,
  EventAdapter,
  EventCatalog,
  PortToken,
} from '@plinth/domain';
import { wrapEvent } from './envelope.js';
import type { Handler, Interceptor } from './interceptor.js';
import type { RpcMiddleware } from './middleware.js';

export type InvokeDeps = {
  ports: Map<PortToken<unknown>, unknown>;
  catalogs: Map<EventCatalog, EventAdapter>;
  interceptors: Interceptor[];
  middleware: RpcMiddleware[];
  defaultCtx: unknown;
  onFlush?: (envelope: Envelope) => void;
};

export async function invokeApi(
  ctor: ApiUseCaseCtor,
  input: unknown,
  deps: InvokeDeps,
  opts?: { ctx?: unknown; signal?: AbortSignal },
): Promise<unknown> {
  const parsed = validate(ctor.input, input);
  if (!parsed.ok) {
    throw new CodedError({
      code: 'VALIDATION',
      status: 400,
      message: 'Validation failed',
    });
  }
  const queue: Envelope[] = [];
  const publish: Publish = ((event: Parameters<Publish>[0]) => {
    queue.push(wrapEvent(event, ctor.publishes ?? []));
  }) as Publish;

  const ports = aliasPorts(ctor.ports, deps.ports);
  const errors = errorFactories(ctor.errors);
  const ctx = {
    input: parsed.value as Infer<typeof ctor.input>,
    ports,
    ctx: opts?.ctx ?? deps.defaultCtx,
    errors,
    signal: opts?.signal ?? new AbortController().signal,
    publish,
  };

  const instance = new ctor();
  let handler: Handler = (executeCtx) =>
    instance.execute(executeCtx as never) as Promise<unknown>;
  handler = wrapUseCase(ctor, handler, deps.interceptors);
  handler = wrapMiddleware(
    ctor,
    handler,
    [...deps.middleware, ...(ctor.middleware ?? [])] as RpcMiddleware[],
    errors,
  );

  try {
    const output = await handler(ctx as never);
    await flush(queue, deps);
    return output;
  } catch (error) {
    queue.length = 0;
    throw error;
  }
}

export async function invokeEvent(
  ctor: EventUseCaseCtor,
  envelope: Envelope,
  deps: InvokeDeps,
  opts?: { ctx?: unknown; signal?: AbortSignal; attempt?: number },
): Promise<void> {
  const queue: Envelope[] = [];
  const publish: Publish = ((event: Parameters<Publish>[0]) => {
    queue.push(wrapEvent(event, ctor.publishes ?? []));
  }) as Publish;
  const ports = aliasPorts(ctor.ports ?? {}, deps.ports);
  const errors = errorFactories(ctor.errors ?? {});
  const ctx = {
    event: envelope,
    ports,
    ctx: opts?.ctx ?? deps.defaultCtx,
    errors,
    signal: opts?.signal ?? new AbortController().signal,
    publish,
    ...(opts?.attempt !== undefined ? { attempt: opts.attempt } : {}),
  };
  const instance = new ctor();
  let run: () => Promise<void> = () =>
    instance.execute(ctx as never) as Promise<void>;
  run = wrapDispatch(ctor, envelope, run, deps.interceptors);
  let handler: Handler = async () => run();
  handler = wrapUseCase(ctor, handler, deps.interceptors);
  try {
    await handler(ctx as never);
    await flush(queue, deps);
  } catch (error) {
    queue.length = 0;
    throw error;
  }
}

function aliasPorts(
  aliases: Record<string, PortToken<unknown>>,
  provided: Map<PortToken<unknown>, unknown>,
): Record<string, unknown> {
  const ports: Record<string, unknown> = {};
  for (const [alias, token] of Object.entries(aliases)) {
    const impl = provided.get(token);
    if (impl === undefined) {
      throw new Error(`plinth: unprovided port "${token.name}"`);
    }
    ports[alias] = impl;
  }
  return ports;
}

function wrapUseCase(
  ctor: UseCaseClass,
  handler: Handler,
  interceptors: Interceptor[],
): Handler {
  let current = handler;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i];
    if (interceptor?.aroundUseCase) {
      current = interceptor.aroundUseCase(ctor, current);
    }
  }
  return current;
}

function wrapDispatch(
  ctor: UseCaseClass,
  envelope: Envelope,
  run: () => Promise<void>,
  interceptors: Interceptor[],
): () => Promise<void> {
  let current = run;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i];
    const aroundDispatch = interceptor?.aroundDispatch;
    if (aroundDispatch) {
      const inner = current;
      current = () => aroundDispatch(envelope, ctor, inner);
    }
  }
  return current;
}

function wrapMiddleware(
  ctor: ApiUseCaseCtor,
  handler: Handler,
  middleware: RpcMiddleware[],
  errors: { [code: string]: (data?: unknown) => never },
): Handler {
  let current = handler;
  for (let i = middleware.length - 1; i >= 0; i--) {
    const mw = middleware[i];
    if (!mw) continue;
    const inner = current;
    current = async (ctx) => {
      const executeCtx = ctx as {
        ctx: unknown;
        input: unknown;
      };
      return mw({
        context: executeCtx.ctx,
        input: executeCtx.input,
        next: () => inner(ctx),
        errors,
        path: ctor.id,
      });
    };
  }
  return current;
}

async function flush(queue: Envelope[], deps: InvokeDeps): Promise<void> {
  for (const envelope of queue) {
    const adapter = adapterFor(envelope, deps.catalogs);
    const publish = async () => {
      deps.onFlush?.(envelope);
      await adapter.publish(envelope);
    };
    await wrapPublish(envelope, publish, deps.interceptors);
  }
}

function wrapPublish(
  envelope: Envelope,
  publish: () => Promise<void>,
  interceptors: Interceptor[],
): Promise<void> {
  let current = publish;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i];
    const aroundPublish = interceptor?.aroundPublish;
    if (aroundPublish) {
      const inner = current;
      current = () => aroundPublish(envelope, inner);
    }
  }
  return current();
}

export async function publishNow(
  envelope: Envelope,
  deps: InvokeDeps,
): Promise<void> {
  await flush([envelope], deps);
}

function adapterFor(
  envelope: Envelope,
  catalogs: Map<EventCatalog, EventAdapter>,
): EventAdapter {
  for (const [catalog, adapter] of catalogs) {
    if (catalog.name === envelope.catalog) return adapter;
  }
  throw new Error(`plinth: unbound catalog "${envelope.catalog}"`);
}
