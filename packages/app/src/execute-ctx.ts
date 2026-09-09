import type { Infer, Result, StandardSchemaV1 } from '@plinth/core';
import type { DomainEvent, Envelope, EventCatalog } from '@plinth/domain';
import type { ErrorFactories, ResolvedPorts } from './types.js';

/**
 * `publish` **enqueues**. The runtime flushes only if `execute` returns.
 * A throw drops the queue — publish after success, not a coincidence.
 */
export type Publish = {
  (event: DomainEvent): void;
  (envelope: Envelope): void;
};

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
  publish: Publish;
};

type CatalogKindOf<C> = C extends { catalog: EventCatalog<string, infer K> }
  ? K
  : 'bus';

export type EventCtx<C, Ctx = unknown> = {
  event: Envelope;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  ctx: Ctx;
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
  signal: AbortSignal;
  publish: Publish;
} & (CatalogKindOf<C> extends 'broker'
  ? { attempt: number }
  : { attempt?: number });

export type Unwrap = <T, E extends string>(result: Result<T, E>) => T;
