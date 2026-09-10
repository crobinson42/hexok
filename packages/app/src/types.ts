import type { ErrorMap, Infer, StandardSchemaV1 } from '@plinth/core';
import type {
  AnyEventCatalog,
  EventCatalog,
  EventClass,
  PortToken,
} from '@plinth/domain';

export type ResolvedPorts<P> = {
  [K in keyof P]: P[K] extends PortToken<infer I> ? I : never;
};

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
  catalog: EventCatalog<infer _K, infer _Kind, infer Events extends EventClass>;
}
  ? [On] extends [Events]
    ? C
    : `plinth: EventUseCase "${Key}" static on is not in catalog`
  : C;

/**
 * Per-entry diagnostic for `App.from` / `App.test`. Missing statics become a
 * `plinth:` sentence instead of a UseCaseClass union dump.
 */
export type CheckUseCase<C> = C extends { trigger: 'api' }
  ? C extends { ports: Record<string, PortToken<unknown>> }
    ? C
    : `plinth: ApiUseCase "${KeyOf<C>}" is missing static ports`
  : C extends { trigger: 'event' }
    ? C extends { on: { readonly key: string } }
      ? C extends { catalog: AnyEventCatalog }
        ? OnInCatalog<C>
        : `plinth: EventUseCase "${KeyOf<C>}" is missing static catalog`
      : `plinth: EventUseCase "${KeyOf<C>}" is missing static on`
    : `plinth: "${KeyOf<C>}" must extend ApiUseCase or EventUseCase`;

export type UseCaseBag = Record<string, UseCaseClass>;

/** Keep a checked bag's specific classes; do not intersect with UseCaseBag. */
export type AsUseCaseBag<Bag> = Bag extends UseCaseBag ? Bag : UseCaseBag;

export type UseCaseClass = ApiUseCaseCtor | EventUseCaseCtor;

export interface ApiUseCaseCtor {
  readonly trigger: 'api';
  readonly key: string;
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
  readonly errors: ErrorMap;
  readonly ports: Record<string, PortToken<unknown>>;
  readonly publishes?: readonly AnyEventCatalog[];
  readonly middleware?: readonly unknown[];
  new (): { execute(ctx: never): Promise<unknown> };
}

export interface EventUseCaseCtor {
  readonly trigger: 'event';
  readonly key: string;
  readonly on: EventClass;
  readonly catalog: AnyEventCatalog;
  readonly group?: string;
  readonly ports?: Record<string, PortToken<unknown>>;
  readonly publishes?: readonly AnyEventCatalog[];
  readonly errors?: ErrorMap;
  readonly middleware?: readonly unknown[];
  new (): { execute(ctx: never): Promise<void> };
}

export function isEventUseCase(ctor: UseCaseClass): ctor is EventUseCaseCtor {
  return ctor.trigger === 'event';
}

export function isApiUseCase(ctor: UseCaseClass): ctor is ApiUseCaseCtor {
  return ctor.trigger === 'api';
}
