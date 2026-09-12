import type {
  AsUseCaseBag,
  ChannelSession,
  CheckUseCase,
  EventChannelCtor,
  UseCaseBag,
} from '../app/index.js';
import type {
  CatalogKind,
  ChannelAdapter,
  Envelope,
  EventCatalog,
  EventClass,
  PortToken,
} from '../domain/index.js';
import {
  type AdapterFor,
  type AppBuilder,
  type AppInstance,
  type ChannelKindError,
  type DuplicateCatalogError,
  type DuplicateChannelError,
  type DuplicatePortError,
  type Interceptor,
  type MissingMessages,
  type NestedClient,
  type RpcMiddleware,
  App as RuntimeApp,
} from '../runtime/index.js';

/**
 * Built test app: runtime `AppInstance` plus `published` and `as(ctx)`.
 * Use `App.test(...).build()`, then assert `app.published` or call `app.as(ctx)`.
 */
export type TestAppInstance<
  Bag extends UseCaseBag,
  Ctx = unknown,
  Routed = never,
> = AppInstance<Bag, Ctx, Routed> & {
  /** Envelopes that completed `aroundPublish`, in order. */
  published: Envelope[];
  /** Nested local client with `ctx` fixed on every call. */
  as: (ctx: Ctx) => NestedClient<Bag, Ctx>;
};

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

/**
 * Test composition root with the same `provide`/`bind`/`route`/`ctx`/`build`
 * as runtime, plus `published` capture. Construct with `App.test`, not `new`.
 */
export class TestAppBuilder<
  Bag extends UseCaseBag,
  Provided = never,
  Bound = never,
  Ctx = unknown,
  Routed = never,
> {
  readonly #inner: AppBuilder<Bag, Provided, Bound, Ctx, Routed>;
  readonly #published: Envelope[];

  private constructor(
    inner: AppBuilder<Bag, Provided, Bound, Ctx, Routed>,
    published: Envelope[],
  ) {
    this.#inner = inner;
    this.#published = published;
  }

  /** Start a test graph from a use-case bag. The built app has `published` and `as`. */
  static test<Bag extends { [K in keyof Bag]: CheckUseCase<Bag[K]> }>(
    useCases: Bag,
  ): TestAppBuilder<AsUseCaseBag<Bag>> {
    const published: Envelope[] = [];
    const inner = RuntimeApp.from(useCases).intercept({
      key: 'hexok:published',
      aroundPublish: async (envelope, next) => {
        await next();
        published.push(envelope);
      },
    });
    return new TestAppBuilder(inner, published);
  }

  /** Bind a port token to an implementation, usually an in-memory fake. */
  provide<I>(
    token: [PortToken<I>] extends [Provided]
      ? DuplicatePortError
      : PortToken<I>,
    impl: I,
  ): TestAppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx, Routed> {
    const next = this.#inner.provide(token as never, impl);
    return new TestAppBuilder(
      next as AppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx, Routed>,
      this.#published,
    );
  }

  /** Bind a catalog to a bus or queue adapter (`InMemoryBus` / `InMemoryQueue`). */
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
  ): TestAppBuilder<
    Bag,
    Provided,
    Bound | EventCatalog<Key, Kind, Events, CatCtx>,
    Ctx,
    Routed
  > {
    const next = this.#inner.bind(catalog as never, adapter);
    return new TestAppBuilder(
      next as AppBuilder<
        Bag,
        Provided,
        Bound | EventCatalog<Key, Kind, Events, CatCtx>,
        Ctx,
        Routed
      >,
      this.#published,
    );
  }

  /** Route a bus `EventChannel` to a channel adapter (`InMemoryChannel`). */
  route<C extends EventChannelCtor>(
    channel: ChannelCatalogKind<C> extends 'bus'
      ? [C] extends [Routed]
        ? DuplicateChannelError<ChannelCatalogKey<C>>
        : C
      : ChannelKindError<ChannelCatalogKey<C>, ChannelCatalogKind<C> & string>,
    adapter: ChannelAdapter<ChannelSession<C>>,
  ): TestAppBuilder<Bag, Provided, Bound, Ctx, Routed | C> {
    const next = this.#inner.route(channel as never, adapter);
    return new TestAppBuilder(
      next as AppBuilder<Bag, Provided, Bound, Ctx, Routed | C>,
      this.#published,
    );
  }

  /** Set default request context for `local` and HTTP. `as(ctx)` overrides per call. */
  ctx<C>(defaults?: C): TestAppBuilder<Bag, Provided, Bound, C, Routed> {
    const next = this.#inner.ctx(defaults);
    return new TestAppBuilder(next, this.#published);
  }

  /** Register RPC middleware on the inner runtime builder. */
  use(middleware: RpcMiddleware): this {
    this.#inner.use(middleware);
    return this;
  }

  /** Register an interceptor. First registered is outer; `App.test` already captured publish. */
  intercept(interceptor: Interceptor): this {
    this.#inner.intercept(interceptor);
    return this;
  }

  /**
   * Complete the graph; incomplete builders expose `build` as the missing
   * port/catalog message (not callable). The instance includes `published` and `as`.
   */
  get build(): [MissingMessages<Bag, Provided, Bound, Routed>] extends [never]
    ? () => TestAppInstance<Bag, Ctx, Routed>
    : MissingMessages<Bag, Provided, Bound, Routed> {
    const published = this.#published;
    return (() => {
      const app = (
        this.#inner as unknown as {
          build: () => AppInstance<Bag, Ctx, Routed>;
        }
      ).build();
      return Object.assign(app, {
        published,
        as: (ctx: Ctx) => rebindLocal(app.local, ctx) as NestedClient<Bag, Ctx>,
      });
    }) as () => TestAppInstance<Bag, Ctx, Routed> as [
      MissingMessages<Bag, Provided, Bound, Routed>,
    ] extends [never]
      ? () => TestAppInstance<Bag, Ctx, Routed>
      : MissingMessages<Bag, Provided, Bound, Routed>;
  }
}

/**
 * Same completeness as `App.from`, plus `published` capture (after
 * `aroundPublish`) and `as(ctx)` to rebind request context.
 *
 * ```ts
 * const app = App.test({ close: CloseIncident })
 *   .provide(IncidentRepository, InMemoryRepository.of(...))
 *   .bind(DomainEvents, InMemoryBus.create())
 *   .build()
 * await app.local.incident.close({ id: '1' })
 * expect(app.published).toHaveLength(1)
 * ```
 */
export const App = {
  /** Same as `hexok/runtime` `App.from` — no `published` capture. Prefer `test`. */
  from: RuntimeApp.from,
  /** Start a test graph. The built app has `published` and `as`. */
  test: TestAppBuilder.test,
};

function rebindLocal(value: unknown, ctx: unknown): unknown {
  if (typeof value === 'function') {
    return (input: unknown, opts?: { ctx?: unknown; signal?: AbortSignal }) =>
      value(input, { ...opts, ctx });
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = rebindLocal(child, ctx);
    }
    return out;
  }
  return value;
}
