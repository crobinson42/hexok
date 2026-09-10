import type { Infer, Result, StandardSchemaV1 } from '../core/index.js';
import type {
  CatalogEvents,
  DomainEvent,
  Envelope,
  EventCatalog,
  EventClass,
  EventPayload,
} from '../domain/index.js';
import type { ApiUseCaseCtor, ErrorFactories, ResolvedPorts } from './types.js';

/**
 * `publish` **enqueues**. The runtime flushes only if `execute` returns.
 * A throw drops the queue — publish after success, not a coincidence.
 */
export type Publish = {
  (event: DomainEvent): void;
  (envelope: Envelope): void;
};

type AllowedEventInstance<C> = C extends { publishes: readonly (infer Cat)[] }
  ? CatalogEvents<Cat> extends infer E
    ? [E] extends [never]
      ? never
      : InstanceType<Extract<E, EventClass>>
    : never
  : DomainEvent;

export type PublishFor<C> = (event: AllowedEventInstance<C>) => void;

export type Run = <U extends ApiUseCaseCtor>(
  useCase: U,
  input: Infer<U['input']>,
) => Promise<Infer<U['output']>>;

export type ExecuteCtx<C, Ctx = unknown> = {
  input: C extends { input: infer S extends StandardSchemaV1 }
    ? Infer<S>
    : unknown;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  ctx: Ctx;
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
  signal: AbortSignal;
  publish: C extends { publishes: readonly unknown[] }
    ? PublishFor<C>
    : Publish;
  run: Run;
};

type EventOn<C> = C extends { on: infer E extends EventClass } ? E : EventClass;

type CatalogKeyOf<C> = C extends {
  catalog: EventCatalog<infer K extends string, infer _Kind, infer _E>;
}
  ? K
  : string;

type CatalogKindOf<C> = C extends {
  catalog: EventCatalog<string, infer Kind, infer _E>;
}
  ? Kind
  : 'bus';

export type EventCtx<C, Ctx = unknown> = {
  event: Envelope<
    EventOn<C>['key'] extends infer N extends string ? N : string,
    EventPayload<EventOn<C>>,
    CatalogKeyOf<C>,
    CatalogKindOf<C>
  >;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  ctx: Ctx;
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
  signal: AbortSignal;
  publish: C extends { publishes: readonly unknown[] }
    ? PublishFor<C>
    : Publish;
  run: Run;
} & (CatalogKindOf<C> extends 'broker'
  ? { attempt: number }
  : { attempt?: number });

export type Unwrap = <T, E extends string>(result: Result<T, E>) => T;
