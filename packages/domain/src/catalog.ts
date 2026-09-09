import type { CatalogKind } from './envelope.js';
import type { EventClass } from './event.js';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Registry of event classes. `kind` is `'bus'` (in-process) or `'broker'` (acked).
 *
 * ```ts
 * const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
 *   .event(IncidentClosed)
 * DomainEvents.get(IncidentClosed)
 * DomainEvents.incident.closed // when every segment is a JS identifier
 * ```
 */
export class EventCatalog<
  Name extends string = string,
  Kind extends CatalogKind = CatalogKind,
> {
  readonly name: Name;
  readonly kind: Kind;
  #events = new Map<string, EventClass>();
  #frozen = false;

  constructor(name: Name, options: { kind: Kind }) {
    this.name = name;
    this.kind = options.kind;
  }

  /** Registered event classes, in registration order. */
  list(): EventClass[] {
    return [...this.#events.values()];
  }

  event<E extends EventClass>(eventClass: E): this {
    this.assertWritable();
    const eventName = eventClass.name;
    if (this.#events.has(eventName)) {
      throw new Error(
        `plinth: duplicate event "${eventName}" in catalog "${this.name}"`,
      );
    }
    this.#events.set(eventName, eventClass);
    nestIdentifierPath(
      this as unknown as Record<string, unknown>,
      eventName,
      eventClass,
    );
    return this;
  }

  get<E extends EventClass>(eventClass: E): E {
    const found = this.#events.get(eventClass.name);
    if (!found) {
      throw new Error(
        `plinth: event "${eventClass.name}" is not in catalog "${this.name}"`,
      );
    }
    return found as E;
  }

  freeze(): this {
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
      throw new Error(`plinth: catalog "${this.name}" is frozen`);
    }
  }
}

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
