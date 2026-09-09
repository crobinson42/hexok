import type { UseCaseBag } from '@plinth/app';
import type {
  CatalogKind,
  Envelope,
  EventAdapter,
  EventCatalog,
  PortToken,
} from '@plinth/domain';
import {
  type AppBuilder,
  type Interceptor,
  type NestedClient,
  type RpcMiddleware,
  App as RuntimeApp,
} from '@plinth/runtime';

export type TestAppInstance<Bag extends UseCaseBag, Ctx = unknown> = ReturnType<
  Extract<AppBuilder<Bag, never, never, Ctx>['build'], () => unknown>
> & {
  published: Envelope[];
  as: (ctx: Ctx) => NestedClient<Bag, Ctx>;
};

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
  test<Bag extends UseCaseBag>(useCases: Bag): TestAppBuilder<Bag> {
    const published: Envelope[] = [];
    const inner = RuntimeApp.from(useCases).intercept({
      name: 'plinth:published',
      aroundPublish: async (envelope, next) => {
        await next();
        published.push(envelope);
      },
    });
    return new TestAppBuilder(inner, published);
  },
};

export class TestAppBuilder<
  Bag extends UseCaseBag,
  Provided = never,
  Bound = never,
  Ctx = unknown,
> {
  readonly #inner: AppBuilder<Bag, Provided, Bound, Ctx>;
  readonly #published: Envelope[];

  constructor(
    inner: AppBuilder<Bag, Provided, Bound, Ctx>,
    published: Envelope[],
  ) {
    this.#inner = inner;
    this.#published = published;
  }

  provide<I>(
    token: [PortToken<I>] extends [Provided]
      ? `plinth: port already provided`
      : PortToken<I>,
    impl: I,
  ): TestAppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx> {
    const next = this.#inner.provide(token as never, impl);
    return new TestAppBuilder(
      next as AppBuilder<Bag, Provided | PortToken<I>, Bound, Ctx>,
      this.#published,
    );
  }

  bind<Name extends string, Kind extends CatalogKind>(
    catalog: [EventCatalog<Name, Kind>] extends [Bound]
      ? `plinth: catalog already bound`
      : EventCatalog<Name, Kind>,
    adapter: EventAdapter & { kind: Kind },
  ): TestAppBuilder<Bag, Provided, Bound | EventCatalog<Name, Kind>, Ctx> {
    const next = this.#inner.bind(catalog as never, adapter as never);
    return new TestAppBuilder(
      next as AppBuilder<Bag, Provided, Bound | EventCatalog<Name, Kind>, Ctx>,
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

  get build(): AppBuilder<Bag, Provided, Bound, Ctx>['build'] extends (
    ...args: never
  ) => infer Instance
    ? () => Instance & {
        published: Envelope[];
        as: (ctx: Ctx) => NestedClient<Bag, Ctx>;
      }
    : AppBuilder<Bag, Provided, Bound, Ctx>['build'] {
    const inner = this.#inner.build;
    if (typeof inner !== 'function') {
      return inner as never;
    }
    const published = this.#published;
    return (() => {
      const app = inner();
      return Object.assign(app, {
        published,
        as: (ctx: Ctx) => rebindLocal(app.local, ctx) as NestedClient<Bag, Ctx>,
      });
    }) as never;
  }
}

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
