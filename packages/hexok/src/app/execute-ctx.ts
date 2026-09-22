import type { Infer, Result, StandardSchemaV1 } from '../core/index.js';
import type {
  CatalogEvents,
  DomainEvent,
  Envelope,
  EventCatalog,
  EventClass,
  EventPayload,
} from '../domain/index.js';
import type { ChannelProps } from './event-channel.js';
import type { DefinedGuard } from './guard.js';
import type {
  CallableUseCaseCtor,
  ErrorFactories,
  ResolvedPorts,
} from './types.js';

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

/** `publish` when `static publishes` is declared — only those catalog events. */
export type PublishFor<C> = (event: AllowedEventInstance<C>) => void;

/** Nested callable invocation. Shares ctx, signal, and the parent publish queue. */
export type Run = <U extends CallableUseCaseCtor>(
  useCase: U,
  input: Infer<U['input']>,
) => Promise<Infer<U['output']>>;

type ContextOf<C> = C extends { context: infer Ctx } ? Ctx : unknown;

type KeyOf<C> = C extends { key: infer K extends string }
  ? string extends K
    ? 'unknown'
    : K
  : 'unknown';

type GuardsOf<C> = C extends { guards: infer G extends readonly unknown[] }
  ? G
  : readonly [];

type GuardMismatch<C> =
  `hexok: "${KeyOf<C>}" guard InCtx does not accept accumulated ctx`;

/** Branded guards only. Unbranded literals keep `Acc` (they do not narrow). */
type WalkGuards<Guards, Acc, C> = [Guards] extends [
  readonly [infer Head, ...infer Tail],
]
  ? Head extends DefinedGuard<infer In, infer Out>
    ? [Acc] extends [In]
      ? WalkGuards<Tail, Out, C>
      : GuardMismatch<C>
    : WalkGuards<Tail, Acc, C>
  : Acc;

type GuardChain<C> = WalkGuards<GuardsOf<C>, ContextOf<C>, C>;

/**
 * `declare static context` wins over the last `OutCtx`.
 * A chain mismatch replaces `ctx` with a `hexok:` string.
 * Otherwise the last branded `OutCtx`, or `unknown` when nothing narrows.
 */
type DefaultCtx<C> =
  GuardChain<C> extends infer Walked
    ? [Walked] extends [`hexok: ${string}`]
      ? Walked
      : C extends { context: infer Ctx }
        ? Ctx
        : Walked
    : never;

/** Argument to `ExternalUseCase.execute` and `InternalUseCase.execute`. Typed from the subclass statics. `Ctx` is the second generic, else `declare static context`, else the last `defineGuard` `OutCtx`, else `unknown`. */
export type ExecuteCtx<C, Ctx = DefaultCtx<C>> = {
  /** Validated `static input`. */
  input: C extends { input: infer S extends StandardSchemaV1 }
    ? Infer<S>
    : unknown;
  /** Bound adapters from `static ports`. */
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  /** App request context from `App.ctx` or the caller. */
  ctx: Ctx;
  /** Factories from `static errors`. Throw `errors.NOT_FOUND()`. */
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
  /** Abort signal for this invocation. */
  signal: AbortSignal;
  /** Enqueue a catalog event. Flushed only if `execute` returns. */
  publish: C extends { publishes: readonly unknown[] }
    ? PublishFor<C>
    : Publish;
  /** Invoke an ExternalUseCase or InternalUseCase with the same ctx, signal, and publish queue. */
  run: Run;
  /** Presence handles for `static channels`, keyed by catalog key. */
  channels: ChannelProps<C>;
};

type EventOn<C> = C extends { on: infer E extends EventClass } ? E : EventClass;

type CatalogKeyOf<C> = C extends {
  catalog: EventCatalog<
    infer K extends string,
    infer _Kind,
    infer _E,
    infer _Ctx
  >;
}
  ? K
  : string;

type CatalogKindOf<C> = C extends {
  catalog: EventCatalog<string, infer Kind, infer _E, infer _Ctx>;
}
  ? Kind
  : 'bus';

type CatalogCtxOf<C> = C extends {
  catalog: EventCatalog<string, infer _Kind, infer _E, infer Ctx>;
}
  ? Ctx
  : unknown;

/** Argument to `EventUseCase.execute`. Typed from the subclass statics. `Ctx` is the second generic, else `declare static context`, else the last `defineGuard` `OutCtx`, else `unknown`. */
export type EventCtx<C, Ctx = DefaultCtx<C>> = {
  /** Envelope for `static on`, including payload and catalog metadata. */
  event: Envelope<
    EventOn<C>['key'] extends infer N extends string ? N : string,
    EventPayload<EventOn<C>>,
    CatalogKeyOf<C>,
    CatalogKindOf<C>,
    CatalogCtxOf<C>
  >;
  /** Bound adapters from `static ports`. */
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  /** App request context from `App.ctx` or the caller. */
  ctx: Ctx;
  /** Factories from `static errors`. Throw `errors.NOT_FOUND()`. */
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
  /** Abort signal for this invocation. */
  signal: AbortSignal;
  /** Enqueue a catalog event. Flushed only if `execute` returns. */
  publish: C extends { publishes: readonly unknown[] }
    ? PublishFor<C>
    : Publish;
  /** Invoke an ExternalUseCase or InternalUseCase with the same ctx, signal, and publish queue. */
  run: Run;
  /** Presence handles for `static channels`, keyed by catalog key. */
  channels: ChannelProps<C>;
} & (CatalogKindOf<C> extends 'queue'
  ? {
      /** Delivery attempt, 1-based, for queue catalogs. */
      attempt: number;
    }
  : {
      /** Unset for bus catalogs. */
      attempt?: number;
    });

export type Unwrap = <T, E extends string>(result: Result<T, E>) => T;
