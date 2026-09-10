import type {
  AnyEventCatalog,
  DomainEvent,
  Envelope,
  EventClass,
} from '@plinth/domain';

export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    'payload' in value &&
    'catalog' in value &&
    'kind' in value &&
    'occurredAt' in value
  );
}

export function wrapEvent(
  event: DomainEvent | Envelope,
  catalogs: readonly AnyEventCatalog[],
): Envelope {
  if (isEnvelope(event)) return event;
  const Ctor = event.constructor as EventClass;
  const catalog = catalogs.find((item) =>
    item.list().some((registered) => registered.key === Ctor.key),
  );
  if (!catalog) {
    throw new Error(
      `plinth: event "${Ctor.key}" is not in a bound catalog declared by publishes`,
    );
  }
  return {
    key: Ctor.key,
    payload: event.payload,
    catalog: catalog.key,
    kind: catalog.kind,
    occurredAt: new Date(),
    meta: {},
  };
}
