import type {
  AnyEventCatalog,
  DomainEvent,
  Envelope,
  EventClass,
} from '../domain/index.js';

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

/** Wrap a domain event in an envelope, or pass an envelope through. The event must belong to one of `catalogs`. */
export function wrapEvent(
  event: DomainEvent | Envelope,
  catalogs: readonly AnyEventCatalog[],
  requestCtx?: unknown,
): Envelope {
  if (isEnvelope(event)) return copyTracing(event, requestCtx, false);
  const Ctor = event.constructor as EventClass;
  const catalog = catalogs.find((item) =>
    item.list().some((registered) => registered === Ctor),
  );
  if (!catalog) {
    throw new Error(
      `hexok: event "${Ctor.key}" is not in a bound catalog declared by publishes`,
    );
  }
  const envelope: Envelope = {
    key: Ctor.key,
    payload: event.payload,
    catalog: catalog.key,
    kind: catalog.kind,
    occurredAt: new Date(),
    meta: {},
  };
  if (catalog.hasCtx) {
    if (!('ctx' in event)) {
      throw new Error(
        `hexok: event "${Ctor.key}" is missing ctx for catalog "${catalog.key}"`,
      );
    }
    envelope.ctx = (event as { ctx: unknown }).ctx;
  }
  return copyTracing(envelope, requestCtx, true);
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

function copyTracing(
  envelope: Envelope,
  requestCtx: unknown,
  overwrite: boolean,
): Envelope {
  const correlationId = stringField(requestCtx, 'correlationId');
  const causationId = stringField(requestCtx, 'causationId');
  if (
    correlationId !== undefined &&
    (overwrite || envelope.correlationId === undefined)
  ) {
    envelope.correlationId = correlationId;
  }
  if (
    causationId !== undefined &&
    (overwrite || envelope.causationId === undefined)
  ) {
    envelope.causationId = causationId;
  }
  return envelope;
}

/** Request ctx plus `correlationId` inherited from an incoming envelope when ctx omits it. */
export function tracingCtx(requestCtx: unknown, incoming?: Envelope): unknown {
  const correlationId =
    stringField(requestCtx, 'correlationId') ?? incoming?.correlationId;
  const causationId = stringField(requestCtx, 'causationId');
  if (correlationId === undefined && causationId === undefined) {
    return requestCtx;
  }
  return {
    ...(typeof requestCtx === 'object' && requestCtx !== null
      ? requestCtx
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(causationId !== undefined ? { causationId } : {}),
  };
}
