import {
  type ApiUseCaseCtor,
  type EventUseCaseCtor,
  errorFactories,
  type Publish,
  type UseCaseClass,
} from '../app/index.js';
import { CodedError, type Infer, validate } from '../core/index.js';
import type {
  AnyEventCatalog,
  Envelope,
  EventAdapter,
  PortToken,
} from '../domain/index.js';
import { wrapEvent } from './envelope.js';
import type { Handler, Interceptor } from './interceptor.js';
import type { RpcMiddleware } from './middleware.js';

export type InvokeDeps = {
  ports: Map<PortToken<unknown>, unknown>;
  catalogs: Map<AnyEventCatalog, EventAdapter>;
  interceptors: Interceptor[];
  middleware: RpcMiddleware[];
  defaultCtx: unknown;
  onFlush?: (envelope: Envelope) => void;
  channels?: Record<string, unknown>;
};

type SharedInvoke = {
  ctx: unknown;
  signal: AbortSignal;
};

function nestedRun(
  deps: InvokeDeps,
  queue: Envelope[],
  shared: SharedInvoke,
): (ctor: ApiUseCaseCtor, input: unknown) => Promise<unknown> {
  const run = (ctor: ApiUseCaseCtor, input: unknown) =>
    runNested(ctor, input, deps, queue, shared, run);
  return run;
}

async function runNested(
  ctor: ApiUseCaseCtor,
  input: unknown,
  deps: InvokeDeps,
  queue: Envelope[],
  shared: SharedInvoke,
  run: (ctor: ApiUseCaseCtor, input: unknown) => Promise<unknown>,
): Promise<unknown> {
  const parsed = validate(ctor.input, input);
  if (!parsed.ok) {
    throw new CodedError({
      code: 'VALIDATION',
      message: 'Validation failed',
    });
  }
  const publish: Publish = ((event: Parameters<Publish>[0]) => {
    queue.push(wrapEvent(event, ctor.publishes ?? []));
  }) as Publish;
  const ctx = {
    input: parsed.value as Infer<typeof ctor.input>,
    ports: aliasPorts(ctor.ports, deps.ports),
    ctx: shared.ctx,
    errors: errorFactories(ctor.errors),
    signal: shared.signal,
    publish,
    run,
    channels: aliasChannels(ctor.channels, deps.channels),
  };
  const instance = constructUseCase(ctor);
  return instance.execute(ctx as never) as Promise<unknown>;
}

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
      message: 'Validation failed',
    });
  }
  const queue: Envelope[] = [];
  const shared: SharedInvoke = {
    ctx: opts?.ctx ?? deps.defaultCtx,
    signal: opts?.signal ?? new AbortController().signal,
  };
  const run = nestedRun(deps, queue, shared);
  const publish: Publish = ((event: Parameters<Publish>[0]) => {
    queue.push(wrapEvent(event, ctor.publishes ?? []));
  }) as Publish;

  const ports = aliasPorts(ctor.ports, deps.ports);
  const errors = errorFactories(ctor.errors);
  const ctx = {
    input: parsed.value as Infer<typeof ctor.input>,
    ports,
    ctx: shared.ctx,
    errors,
    signal: shared.signal,
    publish,
    run,
    channels: aliasChannels(ctor.channels, deps.channels),
  };

  const instance = constructUseCase(ctor);
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
  const shared: SharedInvoke = {
    ctx: opts?.ctx ?? deps.defaultCtx,
    signal: opts?.signal ?? new AbortController().signal,
  };
  const run = nestedRun(deps, queue, shared);
  const publish: Publish = ((event: Parameters<Publish>[0]) => {
    queue.push(wrapEvent(event, ctor.publishes ?? []));
  }) as Publish;
  const ports = aliasPorts(ctor.ports ?? {}, deps.ports);
  const errors = errorFactories(ctor.errors ?? {});
  const ctx = {
    event: envelope,
    ports,
    ctx: shared.ctx,
    errors,
    signal: shared.signal,
    publish,
    run,
    channels: aliasChannels(ctor.channels, deps.channels),
    ...(opts?.attempt !== undefined ? { attempt: opts.attempt } : {}),
  };
  const instance = constructUseCase(ctor);
  let dispatch: () => Promise<void> = () =>
    instance.execute(ctx as never) as Promise<void>;
  dispatch = wrapDispatch(ctor, envelope, dispatch, deps.interceptors);
  let handler: Handler = async () => dispatch();
  handler = wrapUseCase(ctor, handler, deps.interceptors);
  try {
    await handler(ctx as never);
    await flush(queue, deps);
  } catch (error) {
    queue.length = 0;
    throw error;
  }
}

function constructUseCase<T>(ctor: { prototype: T }): T {
  return new (ctor as unknown as new () => T)();
}

export function aliasPorts(
  aliases: Record<string, PortToken<unknown>>,
  provided: Map<PortToken<unknown>, unknown>,
): Record<string, unknown> {
  const ports: Record<string, unknown> = {};
  for (const [alias, token] of Object.entries(aliases)) {
    const impl = provided.get(token);
    if (impl === undefined) {
      throw new Error(`hexok: unprovided port "${token.key}"`);
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
        path: ctor.key,
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

function aliasChannels(
  declared: readonly { catalog: { key: string } }[] | undefined,
  all: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!declared || declared.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const ctor of declared) {
    const key = ctor.catalog.key;
    const handle = all?.[key];
    if (handle === undefined) {
      throw new Error(`hexok: unrouted channel "${key}"`);
    }
    out[key] = handle;
  }
  return out;
}

function adapterFor(
  envelope: Envelope,
  catalogs: Map<AnyEventCatalog, EventAdapter>,
): EventAdapter {
  for (const [catalog, adapter] of catalogs) {
    if (catalog.key === envelope.catalog) return adapter;
  }
  throw new Error(`hexok: unbound catalog "${envelope.catalog}"`);
}
