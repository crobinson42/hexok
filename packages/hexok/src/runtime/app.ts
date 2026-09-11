import {
  type ApiUseCaseCtor,
  type AsUseCaseBag,
  type ChannelSession,
  type CheckUseCase,
  type DerivedContract,
  deriveContract,
  type EventChannelCtor,
  type EventUseCaseCtor,
  isApiUseCase,
  isEventUseCase,
  nestByKey,
  type UseCaseBag,
  type UseCaseClass,
  type UseCaseContract,
} from '../app/index.js';
import type {
  AnyEventCatalog,
  BusAdapter,
  CatalogKind,
  ChannelAdapter,
  Envelope,
  EventAdapter,
  EventCatalog,
  EventClass,
  PortToken,
  QueueAdapter,
} from '../domain/index.js';
import {
  type ChannelGateways,
  createChannelHandle,
  type RoutedChannel,
  resolveChannelPorts,
  startChannels,
  stopChannelAdapters,
} from './channel.js';
import type { NestedClient } from './client.js';
import type {
  ChannelKindError,
  DuplicateCatalogError,
  DuplicateChannelError,
  DuplicatePortError,
  MissingMessages,
} from './completeness.js';
import { startHandlers, stopAdapters } from './events.js';
import { createFetchHandler } from './http.js';
import type { Interceptor } from './interceptor.js';
import { type InvokeDeps, invokeApi, publishNow } from './invoke.js';
import type { RpcMiddleware } from './middleware.js';
import { deriveRpc, type RpcContract } from './rpc.js';

export type AppInstance<
  Bag extends UseCaseBag,
  Ctx = unknown,
  Routed = never,
> = {
  contract: DerivedContract<Bag>;
  router: { fetch: (request: Request) => Promise<Response> };
  local: NestedClient<Bag, Ctx>;
  handlers: Record<string, Record<string, EventUseCaseCtor[]>>;
  channels: ChannelGateways<Routed>;
  publish(envelope: Envelope): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly rpc: RpcContract;
};

export type AdapterFor<K extends CatalogKind> = K extends 'bus'
  ? BusAdapter
  : K extends 'queue'
    ? QueueAdapter
    : EventAdapter;

type ChannelCatalogKind<C> = C extends {
  catalog: EventCatalog<string, infer Kind, infer _E, infer _Ctx>;
}
  ? Kind
  : CatalogKind;

type ChannelCatalogKey<C> = C extends {
  catalog: EventCatalog<
    infer K extends string,
    infer _Kind,
    infer _E,
    infer _Ctx
  >;
}
  ? K
  : string;

export class AppBuilder<
  Bag extends UseCaseBag,
  Provided = never,
  Bound = never,
  Ctx = unknown,
  Routed = never,
> {
  readonly #useCases: Bag;
  readonly #provided = new Map<PortToken<unknown>, unknown>();
  readonly #bound = new Map<AnyEventCatalog, EventAdapter>();
  readonly #routed = new Map<AnyEventCatalog, RoutedChannel>();
  readonly #interceptors: Interceptor[] = [];
  readonly #middleware: RpcMiddleware[] = [];
  #defaultCtx: unknown;

  private constructor(useCases: Bag) {
    this.#useCases = useCases;
  }

  static from<Bag extends { [K in keyof Bag]: CheckUseCase<Bag[K]> }>(
    useCases: Bag,
  ): AppBuilder<AsUseCaseBag<Bag>, never, never, unknown> {
    return new AppBuilder(useCases as AsUseCaseBag<Bag>);
  }

  provide<I>(
    token: [PortToken<I>] extends [Provided]
      ? DuplicatePortError
      : PortToken<I>,
    impl: I,
  ): AppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx, Routed> {
    const port = token as PortToken<I>;
    if (this.#provided.has(port as PortToken<unknown>)) {
      throw new Error(`hexok: port "${port.key}" already provided`);
    }
    for (const existing of this.#provided.keys()) {
      if (existing.key === port.key && existing !== port) {
        throw new Error(`hexok: two tokens share the key "${port.key}"`);
      }
    }
    this.#provided.set(port as PortToken<unknown>, impl);
    return this as unknown as AppBuilder<
      Bag,
      Provided | PortToken<I>,
      Bound,
      Ctx,
      Routed
    >;
  }

  bind<
    Key extends string,
    Kind extends CatalogKind,
    Events extends EventClass = never,
    CatCtx = undefined,
  >(
    catalog: [EventCatalog<Key, Kind, Events, CatCtx>] extends [Bound]
      ? DuplicateCatalogError<Key>
      : EventCatalog<Key, Kind, Events, CatCtx>,
    adapter: AdapterFor<Kind>,
  ): AppBuilder<
    Bag,
    Provided,
    Bound | EventCatalog<Key, Kind, Events, CatCtx>,
    Ctx,
    Routed
  > {
    const cat = catalog as EventCatalog<Key, Kind, Events, CatCtx>;
    if (this.#bound.has(cat as AnyEventCatalog)) {
      throw new Error(`hexok: catalog "${cat.key}" already bound`);
    }
    if (adapter.kind !== cat.kind) {
      throw new Error(
        `hexok: catalog "${cat.key}" is kind "${cat.kind}" but the adapter is "${adapter.kind}"`,
      );
    }
    cat.freeze();
    this.#bound.set(cat as AnyEventCatalog, adapter);
    return this as unknown as AppBuilder<
      Bag,
      Provided,
      Bound | EventCatalog<Key, Kind, Events, CatCtx>,
      Ctx,
      Routed
    >;
  }

  route<C extends EventChannelCtor>(
    channel: ChannelCatalogKind<C> extends 'bus'
      ? [C] extends [Routed]
        ? DuplicateChannelError<ChannelCatalogKey<C>>
        : C
      : ChannelKindError<ChannelCatalogKey<C>, ChannelCatalogKind<C> & string>,
    adapter: ChannelAdapter<ChannelSession<C>>,
  ): AppBuilder<Bag, Provided, Bound, Ctx, Routed | C> {
    const ctor = channel as EventChannelCtor;
    const catalog = ctor.catalog;
    if (catalog.kind !== 'bus') {
      throw new Error(
        `hexok: channel catalog "${catalog.key}" is kind "${catalog.kind}". Channels require a bus catalog.`,
      );
    }
    if (this.#routed.has(catalog)) {
      throw new Error(`hexok: catalog "${catalog.key}" already routed`);
    }
    catalog.freeze();
    const instance = new (
      ctor as unknown as new () => RoutedChannel['instance']
    )();
    this.#routed.set(catalog, {
      ctor,
      instance,
      adapter: adapter as ChannelAdapter<unknown>,
      ports: {},
    });
    return this as unknown as AppBuilder<Bag, Provided, Bound, Ctx, Routed | C>;
  }

  ctx<C>(defaults?: C): AppBuilder<Bag, Provided, Bound, C, Routed> {
    this.#defaultCtx = defaults;
    return this as unknown as AppBuilder<Bag, Provided, Bound, C, Routed>;
  }

  use(middleware: RpcMiddleware): this {
    this.#middleware.push(middleware);
    return this;
  }

  intercept(interceptor: Interceptor): this {
    if (this.#interceptors.some((item) => item.key === interceptor.key)) {
      throw new Error(`hexok: duplicate interceptor key "${interceptor.key}"`);
    }
    this.#interceptors.push(interceptor);
    return this;
  }

  /**
   * Complete the graph. Incomplete builders expose `build` as the missing
   * port/catalog message (not callable). Runtime throws the same sentences.
   */
  get build(): [MissingMessages<Bag, Provided, Bound, Routed>] extends [never]
    ? () => AppInstance<Bag, Ctx, Routed>
    : MissingMessages<Bag, Provided, Bound, Routed> {
    return (() => this.#build()) as unknown as [
      MissingMessages<Bag, Provided, Bound, Routed>,
    ] extends [never]
      ? () => AppInstance<Bag, Ctx, Routed>
      : MissingMessages<Bag, Provided, Bound, Routed>;
  }

  #build(): AppInstance<Bag, Ctx, Routed> {
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

    for (const routed of this.#routed.values()) {
      routed.ports = resolveChannelPorts(routed.ctor, adapted);
    }

    const api = new Map<string, ApiUseCaseCtor>();
    const eventHandlers = new Map<string, EventUseCaseCtor[]>();
    const handlersView: Record<string, Record<string, EventUseCaseCtor[]>> = {};

    for (const ctor of Object.values(this.#useCases) as UseCaseClass[]) {
      if (isApiUseCase(ctor)) {
        if (!ctor.internal) api.set(ctor.key, ctor);
        continue;
      }
      if (isEventUseCase(ctor)) {
        const handlerKey = `${ctor.catalog.key}:${ctor.on.key}`;
        const list = eventHandlers.get(handlerKey) ?? [];
        list.push(ctor);
        eventHandlers.set(handlerKey, list);
        const byCatalog = handlersView[ctor.catalog.key] ?? {};
        const byEvent = byCatalog[ctor.on.key] ?? [];
        byEvent.push(ctor);
        byCatalog[ctor.on.key] = byEvent;
        handlersView[ctor.catalog.key] = byCatalog;
      }
    }

    const catalog = deriveContract(this.#useCases);
    const rpc = deriveRpc(catalog);

    const channelHandles: Record<string, unknown> = {};
    for (const [cat, routed] of this.#routed) {
      channelHandles[cat.key] = createChannelHandle(
        routed.ctor,
        routed.instance,
        routed.adapter,
        routed.ports,
      );
    }

    const deps = (): InvokeDeps => ({
      ports: adapted,
      catalogs: this.#bound,
      interceptors: this.#interceptors,
      middleware: this.#middleware,
      defaultCtx: this.#defaultCtx,
      channels: channelHandles,
    });

    const local = nestByKey(
      [...api.entries()].map(([key, ctor]) => [
        key,
        (input: unknown, opts?: { ctx?: Ctx; signal?: AbortSignal }) =>
          invokeApi(ctor, input, deps(), opts),
      ]),
    ) as NestedClient<Bag, Ctx>;

    let started = false;

    const instance: AppInstance<Bag, Ctx, Routed> = {
      contract: nestedContract(catalog) as DerivedContract<Bag>,
      rpc,
      router: { fetch: createFetchHandler(api, deps()) },
      local,
      handlers: handlersView,
      channels: channelHandles as ChannelGateways<Routed>,
      publish: (envelope) => publishNow(envelope, deps()),
      start: async () => {
        if (started) throw new Error('hexok: start() called twice');
        started = true;
        await startHandlers(this.#bound, eventHandlers, deps());
        startChannels(this.#routed, this.#bound);
      },
      stop: async () => {
        await stopChannelAdapters(this.#routed);
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
      { catalog: AnyEventCatalog; usedBy: string[] }
    >();
    const requiredChannels = new Map<
      string,
      { ctor: EventChannelCtor; usedBy: string[] }
    >();

    for (const ctor of Object.values(this.#useCases) as UseCaseClass[]) {
      const ports = (ctor.ports ?? {}) as Record<string, PortToken<unknown>>;
      for (const token of Object.values(ports)) {
        const rec = requiredPorts.get(token.key) ?? { token, usedBy: [] };
        rec.usedBy.push(ctor.key);
        requiredPorts.set(token.key, rec);
      }
      const catalogs: AnyEventCatalog[] = [
        ...((ctor.publishes ?? []) as AnyEventCatalog[]),
        ...('catalog' in ctor && ctor.catalog ? [ctor.catalog] : []),
      ];
      for (const catalog of catalogs) {
        const rec = requiredCatalogs.get(catalog.key) ?? {
          catalog,
          usedBy: [],
        };
        rec.usedBy.push(ctor.key);
        requiredCatalogs.set(catalog.key, rec);
      }
      for (const channel of ctor.channels ?? []) {
        const rec = requiredChannels.get(channel.catalog.key) ?? {
          ctor: channel,
          usedBy: [],
        };
        rec.usedBy.push(ctor.key);
        requiredChannels.set(channel.catalog.key, rec);
      }
    }

    for (const routed of this.#routed.values()) {
      const ports = (routed.ctor.ports ?? {}) as Record<
        string,
        PortToken<unknown>
      >;
      for (const token of Object.values(ports)) {
        const rec = requiredPorts.get(token.key) ?? {
          token,
          usedBy: [],
        };
        rec.usedBy.push(routed.ctor.catalog.key);
        requiredPorts.set(token.key, rec);
      }
      const catalog = routed.ctor.catalog;
      const rec = requiredCatalogs.get(catalog.key) ?? {
        catalog,
        usedBy: [],
      };
      rec.usedBy.push('channel');
      requiredCatalogs.set(catalog.key, rec);
    }

    for (const { token, usedBy } of requiredPorts.values()) {
      if (!this.#provided.has(token)) {
        throw new Error(
          `hexok: unprovided port "${token.key}" (used by ${usedBy.join(', ')})`,
        );
      }
    }
    for (const { catalog, usedBy } of requiredCatalogs.values()) {
      if (!this.#bound.has(catalog)) {
        throw new Error(
          `hexok: unbound catalog "${catalog.key}" (used by ${usedBy.join(', ')})`,
        );
      }
    }
    for (const { ctor, usedBy } of requiredChannels.values()) {
      if (!this.#routed.has(ctor.catalog)) {
        throw new Error(
          `hexok: unrouted channel "${ctor.catalog.key}" (used by ${usedBy.join(', ')}). Call .route(...) before .build()`,
        );
      }
    }
  }
}

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
  from: AppBuilder.from,
};

function nestedContract(catalog: UseCaseContract): Record<string, unknown> {
  return nestByKey(Object.entries(catalog.routes));
}
