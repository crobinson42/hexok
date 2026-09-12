import type { Infer, StandardSchemaV1 } from '../core/index.js';

/**
 * Domain events are classes. Construction types the payload;
 * validation happens at the use-case / RPC edge, not in the constructor.
 *
 * ```ts
 * class IncidentClosed extends DomainEvent {
 *   static readonly key = 'incident.closed'
 *   static readonly schema = z.object({ id: z.string(), closedAt: z.date() })
 *   constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
 *     super()
 *   }
 * }
 * ```
 */
export abstract class DomainEvent<P = unknown> {
  /** Dotted event name, e.g. `'incident.closed'`. Declare on each subclass. */
  static readonly key: string;
  /** Standard Schema for the payload, applied at the use-case / RPC edge. */
  static readonly schema: StandardSchemaV1;
  /** Event body. Typed by the subclass constructor; not validated here. */
  abstract readonly payload: P;
}

/** Event subclass constructor: `key`, `schema`, and `new (payload)`. */
export type EventClass<P = never> = {
  /** Dotted event name, e.g. `'incident.closed'`. */
  readonly key: string;
  /** Standard Schema for the payload, applied at the use-case / RPC edge. */
  readonly schema: StandardSchemaV1;
  new (payload: P, ...args: never[]): DomainEvent<unknown>;
};

/** Payload type inferred from an event class's `schema`. */
export type EventPayload<E extends EventClass> = Infer<E['schema']>;

type EventKeyOf<E> = E extends { readonly key: infer K extends string }
  ? K
  : string;

/** `catalog.event()` argument when the catalog declared `.ctx<T>()`. */
export type EventWithCtx<E extends EventClass, Ctx> = [
  InstanceType<E>,
] extends [{ ctx: Ctx }]
  ? E
  : `hexok: event "${EventKeyOf<E>}" is missing ctx for this catalog`;
