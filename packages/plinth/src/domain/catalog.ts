import type { CatalogKind } from './envelope.js';
import type { EventClass } from './event.js';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Registry of event classes. `kind` is `'bus'` (pub/sub, fire-and-forget, no
 * persistence) or `'broker'` (acked consume with groups).
 * `.event()` accumulates each class on the covariant `Events` generic (empty is `never`).
 * Use-case convention: `static publishes = [DomainEvents] as const`.
 *
 * ```ts
 * const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
 *   .event(IncidentClosed)
 * DomainEvents.get(IncidentClosed)
 * DomainEvents.incident.closed // when every segment is a JS identifier
 * ```
 */
export class EventCatalog<
  Key extends string = string,
  Kind extends CatalogKind = CatalogKind,
  out Events extends EventClass = never,
> {
  readonly key: Key;
  readonly kind: Kind;
  #events = new Map<string, EventClass>();
  #frozen = false;

  constructor(key: Key, options: { kind: Kind }) {
    this.key = key;
    this.kind = options.kind;
  }

  /** Registered event classes, in registration order. */
  list(): EventClass[] {
    return [...this.#events.values()];
  }

  event<E extends EventClass>(
    eventClass: E,
  ): EventCatalog<Key, Kind, Events | E> {
    this.assertWritable();
    const eventKey = eventClass.key;
    if (this.#events.has(eventKey)) {
      throw new Error(
        `plinth: duplicate event "${eventKey}" in catalog "${this.key}"`,
      );
    }
    this.#events.set(eventKey, eventClass);
    nestIdentifierPath(
      this as unknown as Record<string, unknown>,
      eventKey,
      eventClass,
    );
    return this;
  }

  get<E extends EventClass>(eventClass: E): E {
    const found = this.#events.get(eventClass.key);
    if (!found) {
      throw new Error(
        `plinth: event "${eventClass.key}" is not in catalog "${this.key}"`,
      );
    }
    return found as E;
  }

  freeze(): EventCatalog<Key, Kind, Events> {
    if (this.#frozen) return this;
    this.#frozen = true;
    Object.freeze(this);
    return this;
  }

  get frozen(): boolean {
    return this.#frozen;
  }

  private assertWritable(): void {
    if (this.#frozen) {
      throw new Error(`plinth: catalog "${this.key}" is frozen`);
    }
  }
}

/** Safe annotation / Map key. Bare `EventCatalog` is Events=never and rejects populated catalogs. */
export type AnyEventCatalog = EventCatalog<string, CatalogKind, EventClass>;

export type CatalogEvents<Cat> =
  Cat extends EventCatalog<infer _Key, infer _Kind, infer E extends EventClass>
    ? E
    : never;

function nestIdentifierPath(
  root: Record<string, unknown>,
  dotted: string,
  value: unknown,
): void {
  const parts = dotted.split('.');
  if (parts.length === 0 || parts.some((part) => !IDENT.test(part))) {
    return;
  }
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) return;
    const existing = cursor[key];
    if (existing === undefined) {
      const next: Record<string, unknown> = Object.create(null);
      cursor[key] = next;
      cursor = next;
      continue;
    }
    if (typeof existing === 'object' && existing !== null) {
      cursor = existing as Record<string, unknown>;
      continue;
    }
    return;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) return;
  cursor[last] = value;
}
