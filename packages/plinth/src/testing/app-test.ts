import type { AsUseCaseBag, CheckUseCase, UseCaseBag } from '../app/index.js';
import type {
  CatalogKind,
  Envelope,
  EventCatalog,
  EventClass,
  PortToken,
} from '../domain/index.js';
import {
  type AdapterFor,
  type AppBuilder,
  type AppInstance,
  type DuplicateCatalogError,
  type DuplicatePortError,
  type Interceptor,
  type MissingMessages,
  type NestedClient,
  type RpcMiddleware,
  App as RuntimeApp,
} from '../runtime/index.js';

export type TestAppInstance<
  Bag extends UseCaseBag,
  Ctx = unknown,
> = AppInstance<Bag, Ctx> & {
  published: Envelope[];
  as: (ctx: Ctx) => NestedClient<Bag, Ctx>;
};

export class TestAppBuilder<
  Bag extends UseCaseBag,
  Provided = never,
  Bound = never,
  Ctx = unknown,
> {
  readonly #inner: AppBuilder<Bag, Provided, Bound, Ctx>;
  readonly #published: Envelope[];

  private constructor(
    inner: AppBuilder<Bag, Provided, Bound, Ctx>,
    published: Envelope[],
  ) {
    this.#inner = inner;
    this.#published = published;
  }

  static test<Bag extends { [K in keyof Bag]: CheckUseCase<Bag[K]> }>(
    useCases: Bag,
  ): TestAppBuilder<AsUseCaseBag<Bag>> {
    const published: Envelope[] = [];
    const inner = RuntimeApp.from(useCases).intercept({
      key: 'plinth:published',
      aroundPublish: async (envelope, next) => {
        await next();
        published.push(envelope);
      },
    });
    return new TestAppBuilder(inner, published);
  }

  provide<I>(
    token: [PortToken<I>] extends [Provided]
      ? DuplicatePortError
      : PortToken<I>,
    impl: I,
  ): TestAppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx> {
    const next = this.#inner.provide(token as never, impl);
    return new TestAppBuilder(
      next as AppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx>,
      this.#published,
    );
  }

  bind<
    Key extends string,
    Kind extends CatalogKind,
    Events extends EventClass = never,
  >(
    catalog: [EventCatalog<Key, Kind, Events>] extends [Bound]
      ? DuplicateCatalogError<Key>
      : EventCatalog<Key, Kind, Events>,
    adapter: AdapterFor<Kind>,
  ): TestAppBuilder<
    Bag,
    Provided,
    Bound | EventCatalog<Key, Kind, Events>,
    Ctx
  > {
    const next = this.#inner.bind(catalog as never, adapter);
    return new TestAppBuilder(
      next as AppBuilder<
        Bag,
        Provided,
        Bound | EventCatalog<Key, Kind, Events>,
        Ctx
      >,
      this.#published,
    );
  }

  ctx<C>(defaults?: C): TestAppBuilder<Bag, Provided, Bound, C> {
    const next = this.#inner.ctx(defaults);
    return new TestAppBuilder(next, this.#published);
  }

  use(middleware: RpcMiddleware): this {
    this.#inner.use(middleware);
    return this;
  }

  intercept(interceptor: Interceptor): this {
    this.#inner.intercept(interceptor);
    return this;
  }

  get build(): [MissingMessages<Bag, Provided, Bound>] extends [never]
    ? () => TestAppInstance<Bag, Ctx>
    : MissingMessages<Bag, Provided, Bound> {
    const published = this.#published;
    return (() => {
      const app = (
        this.#inner as unknown as { build: () => AppInstance<Bag, Ctx> }
      ).build();
      return Object.assign(app, {
        published,
        as: (ctx: Ctx) => rebindLocal(app.local, ctx) as NestedClient<Bag, Ctx>,
      });
    }) as () => TestAppInstance<Bag, Ctx> as [
      MissingMessages<Bag, Provided, Bound>,
    ] extends [never]
      ? () => TestAppInstance<Bag, Ctx>
      : MissingMessages<Bag, Provided, Bound>;
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
  from: RuntimeApp.from,
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
