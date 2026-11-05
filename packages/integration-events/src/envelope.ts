/**
 * The queue payload of one integration event. It is a CloudEvents 1.0 event in
 * structured JSON mode, with the `version` extension attribute.
 */
export interface IntegrationEnvelope {
  readonly specversion: '1.0';
  /** Shared by every version that one `publish` emits. */
  readonly id: string;
  /** Contract name. */
  readonly source: string;
  /** Message type. */
  readonly type: string;
  /** Message version. */
  readonly version: number;
  /** ISO 8601 timestamp. */
  readonly time: string;
  /** Present only when the publisher passed one, such as an aggregate id. */
  readonly subject?: string;
  readonly data: unknown;
}

/** Envelope attributes a handler receives as its second argument. */
export interface IntegrationMeta {
  readonly id: string;
  readonly source: string;
  readonly time: string;
  readonly subject?: string;
}

/** The envelope, or `undefined` when `value` is not one. */
export function readEnvelope(value: unknown): IntegrationEnvelope | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (entry.specversion !== '1.0') return undefined;
  for (const key of ['id', 'source', 'type', 'time'] as const) {
    if (typeof entry[key] !== 'string') return undefined;
  }
  if (!Number.isSafeInteger(entry.version)) return undefined;
  if (entry.subject !== undefined && typeof entry.subject !== 'string') {
    return undefined;
  }
  if (!('data' in entry)) return undefined;
  return value as IntegrationEnvelope;
}

export function metaOf(envelope: IntegrationEnvelope): IntegrationMeta {
  const meta = {
    id: envelope.id,
    source: envelope.source,
    time: envelope.time,
  };
  return envelope.subject === undefined
    ? meta
    : { ...meta, subject: envelope.subject };
}
