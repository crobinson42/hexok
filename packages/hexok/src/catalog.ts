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

    /**
     * Serializable `{ key, payload }` for an instance from this catalog.
     * `key` is the map name. Throws when `event` is not registered here.
     */
    static message(
      event: EventInstance<CatalogOf<Events>>,
    ): EventMessage<CatalogOf<Events>> {
      for (const key of Object.keys(registered) as (keyof Events & string)[]) {
        const Ctor = registered[key];
        if (Ctor !== undefined && event instanceof Ctor) {
          // The instance type does not narrow to one catalog key.
          const payload = (event as { readonly payload: unknown }).payload;
          return { key, payload } as EventMessage<CatalogOf<Events>>;
        }
      }
      const name =
        'token' in event && typeof event.token === 'string'
          ? event.token
          : 'unknown';
      throw new Error(`hexok: event "${name}" is not in catalog "${token}"`);
    }

    /**
     * Validate a `{ key, payload }` message and construct the event.
     * Throws when `key` is not in this catalog.
     * Throws `CodedError` `VALIDATION` when the payload schema rejects it.
     */
    static parse(value: unknown): EventInstance<CatalogOf<Events>> {
      if (!isMessage(value)) {
        throw new Error(`hexok: catalog "${token}" expected { key, payload }`);
      }
      if (!Object.hasOwn(registered, value.key)) {
        throw new Error(
          `hexok: event "${value.key}" is not in catalog "${token}"`,
        );
      }
      const EventClass = registered[value.key as keyof Events] as {
        parse?(input: unknown): EventInstance<CatalogOf<Events>>;
      };
      if (typeof EventClass.parse !== 'function') {
        throw new Error(
          `hexok: event "${value.key}" in catalog "${token}" has no parse`,
        );
      }
      return EventClass.parse(value.payload);
    }
  }

  return CatalogClass;
}

/**
 * Instance of an event class. Read from the constructor so
 * {@link EventConstructor}'s `object` return does not erase it.
 */
type EventInstanceOf<Event> = Event extends abstract new (
  ...args: never[]
) => infer Instance
  ? Instance
  : never;

/**
 * Payload of an event class. Read from the instance so
 * {@link EventConstructor}'s `object` return does not erase it.
 */
type EventPayload<Event> =
  EventInstanceOf<Event> extends {
    readonly payload: infer Payload;
  }
    ? Payload
    : never;

/** Catalog shape {@link EventInstance} and {@link EventMessage} read. */
type CatalogOf<Events extends Record<string, EventConstructor>> = {
  readonly events: Events;
};

/**
 * Instance of one catalog entry, or every entry when `Key` is omitted.
 * `token` is the event name. `payload` is the schema output.
 *
 * ```ts
 * abstract publish(event: EventInstance<typeof DomainEvents>): Promise<void>
 * publish(new UserCreated({ id, name, email }))
 * ```
 *
 * `EventInstance<typeof DomainEvents, 'userCreated'>` keeps that one entry.
 */
export type EventInstance<
  Catalog extends { readonly events: Record<string, EventConstructor> },
  Key extends keyof Catalog['events'] & string = keyof Catalog['events'] &
    string,
> = {
  [K in Key]: EventInstanceOf<Catalog['events'][K]>;
}[Key];

/**
 * `{ key, payload }` for one catalog entry, or every entry when `Key` is omitted.
 * `key` is the catalog map name. The event token stays on the instance.
 * Adapters send this value. {@link EventCatalog} `message` and `parse` convert
 * it to and from an {@link EventInstance}.
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

function isMessage(value: unknown): value is { key: string; payload: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('key' in value) || typeof value.key !== 'string') return false;
  return 'payload' in value;
}
