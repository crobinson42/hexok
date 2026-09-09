import type {
  DomainEvent,
  Envelope,
  EventCatalog,
  EventClass,
} from '@plinth/domain';

export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'payload' in value &&
    'catalog' in value &&
    'kind' in value &&
    'occurredAt' in value
  );
}

export function wrapEvent(
  event: DomainEvent | Envelope,
  catalogs: readonly EventCatalog[],
): Envelope {
  if (isEnvelope(event)) return event;
  const Ctor = event.constructor as EventClass;
  const catalog = catalogs.find((item) =>
    item.list().some((registered) => registered.name === Ctor.name),
  );
  if (!catalog) {
    throw new Error(
      `plinth: event "${Ctor.name}" is not in a bound catalog declared by publishes`,
    );
  }
  return {
    name: Ctor.name,
    payload: event.payload,
    catalog: catalog.name,
    kind: catalog.kind,
    occurredAt: new Date(),
    meta: {},
  };
}
