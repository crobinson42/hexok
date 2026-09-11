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
  static readonly key: string;
  abstract readonly payload: P;
}

export type EventClass<P = never> = {
  readonly key: string;
  readonly schema: StandardSchemaV1;
  new (payload: P, ...args: never[]): DomainEvent<unknown>;
};

export type EventPayload<E extends EventClass> = Infer<E['schema']>;

type EventKeyOf<E> = E extends { readonly key: infer K extends string }
  ? K
  : string;

/** `catalog.event()` argument when the catalog declared `.ctx<T>()`. */
export type EventWithCtx<E extends EventClass, Ctx> = [
  InstanceType<E>,
] extends [{ ctx: Ctx }]
  ? E
  : `plinth: event "${EventKeyOf<E>}" is missing ctx for this catalog`;
