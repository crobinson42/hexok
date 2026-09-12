import type { ErrorMap, Infer, StandardSchemaV1 } from '../core/index.js';
import type {
  AnyEventCatalog,
  EventCatalog,
  EventClass,
  PortToken,
} from '../domain/index.js';

/** Port map with tokens replaced by their bound implementations. */
export type ResolvedPorts<P> = {
  [K in keyof P]: P[K] extends PortToken<infer I> ? I : never;
};

/** `errors.CODE()` map. Each factory throws `CodedError` and types as `never`. */
export type ErrorFactories<M> = {
  [K in keyof M]: M[K] extends { data: infer S }
    ? S extends StandardSchemaV1
      ? (data: Infer<S>) => never
      : () => never
    : () => never;
};

type KeyOf<C> = C extends { key: infer I extends string } ? I : 'unknown';

type OnInCatalog<C> = C extends {
  key: infer Key extends string;
  on: infer On;
  catalog: EventCatalog<
    infer _K,
    infer _Kind,
    infer Events extends EventClass,
    infer _Ctx
  >;
}
  ? [On] extends [Events]
    ? C
    : `hexok: EventUseCase "${Key}" static on is not in catalog`
  : C;

/**
 * Per-entry diagnostic for `App.from` / `App.test`. Missing statics become a
 * `hexok:` sentence instead of a UseCaseClass union dump.
 */
export type CheckUseCase<C> = C extends { trigger: 'api' }
  ? C extends { ports: Record<string, PortToken<unknown>> }
    ? C
    : `hexok: ApiUseCase "${KeyOf<C>}" is missing static ports`
  : C extends { trigger: 'event' }
    ? C extends { on: { readonly key: string } }
      ? C extends { catalog: AnyEventCatalog }
        ? OnInCatalog<C>
        : `hexok: EventUseCase "${KeyOf<C>}" is missing static catalog`
      : `hexok: EventUseCase "${KeyOf<C>}" is missing static on`
    : `hexok: "${KeyOf<C>}" must extend ApiUseCase or EventUseCase`;

/** Named map of use-case classes passed to `App.from`. */
export type UseCaseBag = Record<string, UseCaseClass>;

/** Keep a checked bag's specific classes; do not intersect with UseCaseBag. */
export type AsUseCaseBag<Bag> = Bag extends UseCaseBag ? Bag : UseCaseBag;

/** An API or event use-case constructor. */
export type UseCaseClass = ApiUseCaseCtor | EventUseCaseCtor;

/** Constructor shape of an `ApiUseCase` subclass. */
export interface ApiUseCaseCtor {
  readonly trigger: 'api';
  /** Dotted RPC path (`incident.close`). */
  readonly key: string;
  /** Request Standard Schema. */
  readonly input: StandardSchemaV1;
  /** Success Standard Schema. */
  readonly output: StandardSchemaV1;
  /** Declared refusals. */
  readonly errors: ErrorMap;
  /** Port tokens keyed by the alias used in `execute`. */
  readonly ports: Record<string, PortToken<unknown>>;
  /** Catalogs this use case may `publish` to. */
  readonly publishes?: readonly AnyEventCatalog[];
  /** Channels available as `channels` on execute ctx. */
  readonly channels?: readonly EventChannelCtor[];
  /** Per-use-case RPC middleware, after app-level `App.use`. */
  readonly middleware?: readonly unknown[];
  /** When true, omitted from contract, HTTP RPC, and `app.local`. */
  readonly internal?: boolean;
  readonly prototype: { execute(ctx: never): Promise<unknown> };
}

/** Constructor shape of an `EventUseCase` subclass. */
export interface EventUseCaseCtor {
  readonly trigger: 'event';
  /** Handler id (`incident.notifyOnClose`). */
  readonly key: string;
  /** Event class this handler listens to. Must be in `catalog`. */
  readonly on: EventClass;
  /** Catalog that owns `on`. Bind it with `App.bind`. */
  readonly catalog: AnyEventCatalog;
  /** Consumer group for queue catalogs. */
  readonly group?: string;
  /** Port tokens keyed by the alias used in `execute`. */
  readonly ports?: Record<string, PortToken<unknown>>;
  /** Catalogs this handler may `publish` to. */
  readonly publishes?: readonly AnyEventCatalog[];
  /** Channels available as `channels` on event ctx. */
  readonly channels?: readonly EventChannelCtor[];
  /** Declared refusals. */
  readonly errors?: ErrorMap;
  /** Same constructor field as API use cases; event dispatch does not run it. */
  readonly middleware?: readonly unknown[];
  readonly prototype: { execute(ctx: never): Promise<void> };
}

/** Constructor shape of an `EventChannel` subclass (`catalog`, `joinInput`, optional `ports`). */
export interface EventChannelCtor {
  readonly trigger: 'channel';
  /** Catalog whose events this channel delivers. Must be a bus. */
  readonly catalog: AnyEventCatalog;
  /** Port tokens keyed by the alias used in join, refresh, and route. */
  readonly ports?: Record<string, PortToken<unknown>>;
  /** Join-claims Standard Schema. Validated before `join`. */
  readonly joinInput: StandardSchemaV1;
  /** Declared refusals for join/refresh. */
  readonly errors?: ErrorMap;
  readonly prototype: {
    join(ctx: never): Promise<unknown>;
    refresh(ctx: never): Promise<unknown>;
    route(ctx: never): Promise<void>;
  };
}

/** True when `ctor.trigger === 'event'`. */
export function isEventUseCase(ctor: UseCaseClass): ctor is EventUseCaseCtor {
  return ctor.trigger === 'event';
}

/** True when `ctor.trigger === 'api'`. */
export function isApiUseCase(ctor: UseCaseClass): ctor is ApiUseCaseCtor {
  return ctor.trigger === 'api';
}
