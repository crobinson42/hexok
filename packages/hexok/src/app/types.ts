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

type HasLiteralKey<C> = C extends { key: infer K extends string }
  ? string extends K
    ? false
    : true
  : false;

type IsWideArray<T> = T extends readonly unknown[]
  ? number extends T['length']
    ? true
    : false
  : false;

type CheckAsConst<C, Field extends string, Kind extends string> = [C] extends [
  string,
]
  ? C
  : Field extends keyof C
    ? undefined extends C[Field]
      ? C
      : IsWideArray<C[Field]> extends true
        ? `hexok: ${Kind} "${KeyOf<C>}" static ${Field} must be \`as const\``
        : C
    : C;

type CheckCallableShape<C, Kind extends string> =
  HasLiteralKey<C> extends false
    ? `hexok: ${Kind} "${KeyOf<C>}" is missing static key`
    : C extends { input: StandardSchemaV1 }
      ? C extends { output: StandardSchemaV1 }
        ? C extends { ports: Record<string, PortToken<unknown>> }
          ? C
          : `hexok: ${Kind} "${KeyOf<C>}" is missing static ports`
        : `hexok: ${Kind} "${KeyOf<C>}" is missing static output`
      : `hexok: ${Kind} "${KeyOf<C>}" is missing static input`;

type CheckQueueGroup<C> = [C] extends [string]
  ? C
  : C extends { catalog: { kind: 'queue' } }
    ? C extends { group: string }
      ? C
      : `hexok: EventUseCase "${KeyOf<C>}" is missing static group`
    : C;

type CheckEventShape<C> =
  HasLiteralKey<C> extends false
    ? `hexok: EventUseCase "${KeyOf<C>}" is missing static key`
    : C extends { on: { readonly key: string } }
      ? C extends { catalog: AnyEventCatalog }
        ? CheckQueueGroup<OnInCatalog<C>>
        : `hexok: EventUseCase "${KeyOf<C>}" is missing static catalog`
      : `hexok: EventUseCase "${KeyOf<C>}" is missing static on`;

/**
 * Per-entry diagnostic for `App.from` / `App.test`. Missing statics become a
 * `hexok:` sentence instead of a UseCaseClass union dump.
 */
export type CheckUseCase<C> = C extends { trigger: 'external' }
  ? CheckAsConst<
      CheckAsConst<
        CheckCallableShape<C, 'ExternalUseCase'>,
        'publishes',
        'ExternalUseCase'
      >,
      'channels',
      'ExternalUseCase'
    >
  : C extends { trigger: 'internal' }
    ? CheckAsConst<
        CheckAsConst<
          CheckCallableShape<C, 'InternalUseCase'>,
          'publishes',
          'InternalUseCase'
        >,
        'channels',
        'InternalUseCase'
      >
    : C extends { trigger: 'event' }
      ? CheckAsConst<
          CheckAsConst<CheckEventShape<C>, 'publishes', 'EventUseCase'>,
          'channels',
          'EventUseCase'
        >
      : C extends { trigger: 'api' }
        ? `hexok: ApiUseCase was renamed to ExternalUseCase; composition-only use cases extend InternalUseCase — delete static internal`
        : `hexok: "${KeyOf<C>}" must extend ExternalUseCase, InternalUseCase, or EventUseCase`;

/** Named map of use-case classes passed to `App.from`. */
export type UseCaseBag = Record<string, UseCaseClass>;

/** Keep a checked bag's specific classes; do not intersect with UseCaseBag. */
export type AsUseCaseBag<Bag> = Bag extends UseCaseBag ? Bag : UseCaseBag;

/** An external, internal, or event use-case constructor. */
export type UseCaseClass =
  | ExternalUseCaseCtor
  | InternalUseCaseCtor
  | EventUseCaseCtor;

/** Constructor shape of an ExternalUseCase or InternalUseCase subclass. */
export interface CallableUseCaseCtor {
  readonly trigger: 'external' | 'internal';
  /** Use-case id (`incident.close`). Unique among the callable family. */
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
  readonly prototype: { execute(ctx: never): Promise<unknown> };
}

/** Constructor shape of an `ExternalUseCase` subclass. */
export interface ExternalUseCaseCtor extends CallableUseCaseCtor {
  readonly trigger: 'external';
}

/** Constructor shape of an `InternalUseCase` subclass. */
export interface InternalUseCaseCtor extends CallableUseCaseCtor {
  readonly trigger: 'internal';
}

export type ExternalKeyOf<C> = C extends {
  trigger: 'external';
  key: infer Key extends string;
}
  ? Key
  : never;

export type ExternalKeysOf<Bag> = {
  [K in keyof Bag]: ExternalKeyOf<Bag[K]>;
}[keyof Bag];

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

/** True when `ctor.trigger === 'external'`. */
export function isExternalUseCase(
  ctor: UseCaseClass,
): ctor is ExternalUseCaseCtor {
  return ctor.trigger === 'external';
}

/** True when `ctor.trigger === 'internal'`. */
export function isInternalUseCase(
  ctor: UseCaseClass,
): ctor is InternalUseCaseCtor {
  return ctor.trigger === 'internal';
}

/** True when `ctor.trigger` is `'external'` or `'internal'`. */
export function isCallableUseCase(
  ctor: UseCaseClass,
): ctor is CallableUseCaseCtor {
  return ctor.trigger === 'external' || ctor.trigger === 'internal';
}
