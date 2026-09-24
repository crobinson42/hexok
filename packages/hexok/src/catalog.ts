import type { StandardSchemaV1 } from './standard-schema.js';

/** Constructor registered on an {@link EventCatalog}. */
export type EventConstructor = {
  /** Event name. */
  readonly token: string;
  /** Payload schema. */
  readonly schema: StandardSchemaV1;
  // biome-ignore lint/suspicious/noExplicitAny: event constructors take a payload whose type varies per event
  new (...args: any[]): object;
};

/**
 * Named set of event classes. Map keys stay literal without `as const`.
 * Duplicate event tokens throw when the catalog is defined.
 *
 * ```ts
 * class DomainEvents extends EventCatalog('domain', {
 *   userCreated: UserCreated,
 * }) {}
 * ```
 */
export function EventCatalog<
  const Token extends string,
  const Events extends Record<string, EventConstructor>,
>(token: Token, events: Events) {
  const seen = new Set<string>();
  for (const event of Object.values(events)) {
    if (seen.has(event.token)) {
      throw new Error(
        `hexok: duplicate event "${event.token}" in catalog "${token}"`,
      );
    }
    seen.add(event.token);
  }
  const registered = Object.freeze({ ...events }) as Events;

  abstract class CatalogClass {
    /** Catalog name. Literal type of the string passed to {@link EventCatalog}. */
    static readonly token: Token = token;
    /** Event classes, in the shape passed to {@link EventCatalog}. */
    static readonly events: Events = registered;

    /** Registered class for `name`. Throws when `name` is not in this catalog. */
    static get<Name extends keyof Events & string>(name: Name): Events[Name] {
      const event = registered[name];
      if (event === undefined) {
        throw new Error(`hexok: event "${name}" is not in catalog "${token}"`);
      }
      return event;
    }
  }

  return CatalogClass;
}

/**
 * Payload of an event class. Read from the instance so
 * {@link EventConstructor}'s `object` return does not erase it.
 */
type EventPayload<Event> = Event extends abstract new (
  ...args: never[]
) => infer Instance
  ? Instance extends { readonly payload: infer Payload }
    ? Payload
    : never
  : never;

/**
 * `{ key, payload }` for one catalog entry, or every entry when `Key` is omitted.
 * `key` is the catalog map name. The event token stays on the class.
 *
 * ```ts
 * abstract publish(event: EventMessage<typeof DomainEvents>): Promise<void>
 * publish({ key: 'userCreated', payload })
 * ```
 *
 * `EventMessage<typeof DomainEvents, 'userCreated'>` keeps that one entry.
 */
export type EventMessage<
  Catalog extends { readonly events: Record<string, EventConstructor> },
  Key extends keyof Catalog['events'] & string = keyof Catalog['events'] &
    string,
> = {
  [K in Key]: {
    key: K;
    payload: EventPayload<Catalog['events'][K]>;
  };
}[Key];
