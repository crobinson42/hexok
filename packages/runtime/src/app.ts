import {
  type ApiUseCaseCtor,
  type DerivedContract,
  deriveContract,
  type EventUseCaseCtor,
  isApiUseCase,
  isEventUseCase,
  nestById,
  type RpcContract,
  type UseCaseBag,
  type UseCaseClass,
} from '@plinth/app';
import type {
  BrokerAdapter,
  BusAdapter,
  CatalogKind,
  Envelope,
  EventAdapter,
  EventCatalog,
  PortToken,
} from '@plinth/domain';
import type { NestedClient } from './client.js';
import type {
  DuplicateCatalogError,
  DuplicatePortError,
  MissingMessages,
} from './completeness.js';
import { startHandlers, stopAdapters } from './events.js';
import { createFetchHandler } from './http.js';
import type { Interceptor } from './interceptor.js';
import { type InvokeDeps, invokeApi, publishNow } from './invoke.js';
import type { RpcMiddleware } from './middleware.js';

export type AppInstance<Bag extends UseCaseBag, Ctx = unknown> = {
  contract: DerivedContract<Bag>;
  router: { fetch: (request: Request) => Promise<Response> };
  local: NestedClient<Bag, Ctx>;
  handlers: Record<string, Record<string, EventUseCaseCtor[]>>;
  publish(envelope: Envelope): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly rpc: RpcContract;
};

type AdapterFor<K extends CatalogKind> = K extends 'bus'
  ? BusAdapter
  : K extends 'broker'
    ? BrokerAdapter
    : EventAdapter;

/**
 * Composition root. `build()` is only callable when every required port
 * and event catalog is provided.
 *
 * ```ts
 * const app = App.from({ close: CloseIncident })
 *   .provide(IncidentRepository, repo)
 *   .provide(Clock, clock)
 *   .bind(DomainEvents, bus)
 *   .build()
 * await app.local.incident.close({ id: '1' })
 * ```
 */
export const App = {
  from<Bag extends UseCaseBag>(
    useCases: Bag,
  ): AppBuilder<Bag, never, never, unknown> {
    return new AppBuilder(useCases);
  },
};

export class AppBuilder<
  Bag extends UseCaseBag,
  Provided = never,
  Bound = never,
  Ctx = unknown,
> {
  readonly #useCases: Bag;
  readonly #provided = new Map<PortToken<unknown>, unknown>();
  readonly #bound = new Map<EventCatalog, EventAdapter>();
  readonly #interceptors: Interceptor[] = [];
  readonly #middleware: RpcMiddleware[] = [];
  #defaultCtx: unknown;

  constructor(useCases: Bag) {
    this.#useCases = useCases;
  }

  provide<I>(
    token: [PortToken<I>] extends [Provided]
      ? DuplicatePortError
      : PortToken<I>,
    impl: I,
  ): AppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx> {
    const port = token as PortToken<I>;
    if (this.#provided.has(port as PortToken<unknown>)) {
      throw new Error(`plinth: port "${port.name}" already provided`);
    }
    for (const existing of this.#provided.keys()) {
      if (existing.name === port.name && existing !== port) {
        throw new Error(`plinth: two tokens share the name "${port.name}"`);
      }
    }
    this.#provided.set(port as PortToken<unknown>, impl);
    return this as unknown as AppBuilder<
      Bag,
      Provided | PortToken<I>,
      Bound,
      Ctx
    >;
  }

  bind<Name extends string, Kind extends CatalogKind>(
    catalog: [EventCatalog<Name, Kind>] extends [Bound]
      ? DuplicateCatalogError
      : EventCatalog<Name, Kind>,
    adapter: AdapterFor<Kind>,
  ): AppBuilder<Bag, Provided, Bound | EventCatalog<Name, Kind>, Ctx> {
    const cat = catalog as EventCatalog<Name, Kind>;
    if (this.#bound.has(cat as EventCatalog)) {
      throw new Error(`plinth: catalog "${cat.name}" already bound`);
    }
    if (adapter.kind !== cat.kind) {
      throw new Error(
        `plinth: catalog "${cat.name}" is kind "${cat.kind}" but the adapter is "${adapter.kind}"`,
      );
    }
    cat.freeze();
    this.#bound.set(cat as EventCatalog, adapter);
    return this as unknown as AppBuilder<
      Bag,
      Provided,
      Bound | EventCatalog<Name, Kind>,
      Ctx
    >;
  }

  ctx<C>(defaults?: C): AppBuilder<Bag, Provided, Bound, C> {
    this.#defaultCtx = defaults;
    return this as unknown as AppBuilder<Bag, Provided, Bound, C>;
  }

  use(middleware: RpcMiddleware): this {
    this.#middleware.push(middleware);
    return this;
  }

  intercept(interceptor: Interceptor): this {
    if (this.#interceptors.some((item) => item.name === interceptor.name)) {
      throw new Error(
        `plinth: duplicate interceptor name "${interceptor.name}"`,
      );
    }
    this.#interceptors.push(interceptor);
    return this;
  }

  /**
   * Complete the graph. Incomplete builders expose `build` as the missing
   * message string (not callable). Runtime still throws the same sentences.
   */
  get build(): [MissingMessages<Bag, Provided, Bound>] extends [never]
    ? () => AppInstance<Bag, Ctx>
    : MissingMessages<Bag, Provided, Bound> {
    return (() => this.#build()) as unknown as [
      MissingMessages<Bag, Provided, Bound>,
    ] extends [never]
      ? () => AppInstance<Bag, Ctx>
      : MissingMessages<Bag, Provided, Bound>;
  }

  #build(): AppInstance<Bag, Ctx> {
    this.#assertComplete();
    const adapted = new Map<PortToken<unknown>, unknown>();
    for (const [token, impl] of this.#provided) {
      let current: unknown = impl;
      for (const interceptor of this.#interceptors) {
        if (interceptor.aroundAdapter) {
          current = interceptor.aroundAdapter(token, current);
        }
      }
      adapted.set(token, current);
    }

    const api = new Map<string, ApiUseCaseCtor>();
    const eventHandlers = new Map<string, EventUseCaseCtor[]>();
    const handlersView: Record<string, Record<string, EventUseCaseCtor[]>> = {};

    for (const ctor of Object.values(this.#useCases) as UseCaseClass[]) {
      if (isApiUseCase(ctor)) {
        api.set(ctor.id, ctor);
        continue;
      }
      if (isEventUseCase(ctor)) {
        const key = `${ctor.catalog.name}:${ctor.on.name}`;
        const list = eventHandlers.get(key) ?? [];
        list.push(ctor);
        eventHandlers.set(key, list);
        const byCatalog = handlersView[ctor.catalog.name] ?? {};
        const byEvent = byCatalog[ctor.on.name] ?? [];
        byEvent.push(ctor);
        byCatalog[ctor.on.name] = byEvent;
        handlersView[ctor.catalog.name] = byCatalog;
      }
    }

    const rpc = deriveContract(this.#useCases);
    const deps = (): InvokeDeps => ({
      ports: adapted,
      catalogs: this.#bound,
      interceptors: this.#interceptors,
      middleware: this.#middleware,
      defaultCtx: this.#defaultCtx,
    });

    const local = nestById(
      [...api.entries()].map(([id, ctor]) => [
        id,
        (input: unknown, opts?: { ctx?: Ctx; signal?: AbortSignal }) =>
          invokeApi(ctor, input, deps(), opts),
      ]),
    ) as NestedClient<Bag, Ctx>;

    let started = false;

    const instance: AppInstance<Bag, Ctx> = {
      contract: nestedContract(rpc) as DerivedContract<Bag>,
      rpc,
      router: { fetch: createFetchHandler(api, deps()) },
      local,
      handlers: handlersView,
      publish: (envelope) => publishNow(envelope, deps()),
      start: async () => {
        if (started) throw new Error('plinth: start() called twice');
        started = true;
        await startHandlers(this.#bound, eventHandlers, deps());
      },
      stop: async () => {
        if (!started) return;
        await stopAdapters(this.#bound);
        started = false;
      },
    };
    return instance;
  }

  #assertComplete(): void {
    const requiredPorts = new Map<
      string,
      { token: PortToken<unknown>; usedBy: string[] }
    >();
    const requiredCatalogs = new Map<
      string,
      { catalog: EventCatalog; usedBy: string[] }
    >();

    for (const ctor of Object.values(this.#useCases) as UseCaseClass[]) {
      const ports = (ctor.ports ?? {}) as Record<string, PortToken<unknown>>;
      for (const token of Object.values(ports)) {
        const rec = requiredPorts.get(token.name) ?? { token, usedBy: [] };
        rec.usedBy.push(ctor.id);
        requiredPorts.set(token.name, rec);
      }
      const catalogs: EventCatalog[] = [
        ...((ctor.publishes ?? []) as EventCatalog[]),
        ...('catalog' in ctor && ctor.catalog ? [ctor.catalog] : []),
      ];
      for (const catalog of catalogs) {
        const rec = requiredCatalogs.get(catalog.name) ?? {
          catalog,
          usedBy: [],
        };
        rec.usedBy.push(ctor.id);
        requiredCatalogs.set(catalog.name, rec);
      }
    }

    for (const { token, usedBy } of requiredPorts.values()) {
      if (!this.#provided.has(token)) {
        throw new Error(
          `plinth: unprovided port "${token.name}" (used by ${usedBy.join(', ')})`,
        );
      }
    }
    for (const { catalog, usedBy } of requiredCatalogs.values()) {
      if (!this.#bound.has(catalog)) {
        throw new Error(
          `plinth: unbound catalog "${catalog.name}" (used by ${usedBy.join(', ')})`,
        );
      }
    }
  }
}

function nestedContract(rpc: RpcContract): Record<string, unknown> {
  return nestById(Object.entries(rpc.routes));
}
