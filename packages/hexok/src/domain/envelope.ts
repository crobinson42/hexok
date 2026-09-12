/** `'bus'` is fan-out; `'queue'` is competing consumers with ack/nack. */
export type CatalogKind = 'bus' | 'queue';

/**
 * Runtime value on the wire. `kind` is copied from the catalog.
 */
export type Envelope<
  K extends string = string,
  P = unknown,
  Cat extends string = string,
  Kind extends CatalogKind = CatalogKind,
  Ctx = unknown,
> = {
  /** Event class key, e.g. `'incident.closed'`. */
  key: K;
  /** Event payload. */
  payload: P;
  /** Catalog name this event was published through. */
  catalog: Cat;
  /** Copied from the catalog: `'bus'` or `'queue'`. */
  kind: Kind;
  /** When the event was wrapped for the wire. */
  occurredAt: Date;
  /** Catalog ctx when `.ctx()` was declared; omitted otherwise. */
  ctx?: Ctx;
  /** Optional tracing id shared across a conversation. */
  correlationId?: string;
  /** Optional id of the event that caused this one. */
  causationId?: string;
  /** Adapter-reserved fields. Hexok writes `{}`. */
  meta: Record<string, unknown>;
};

/** Fire-and-forget pub/sub. No ack, no consumer group, no persistence in the contract. */
export interface BusAdapter {
  /** Discriminant. Must be `'bus'`. */
  kind: 'bus';
  /** Put one envelope on the bus. */
  publish(envelope: Envelope): Promise<void>;
  /** Register a handler for one event key. */
  subscribe(key: string, handler: (envelope: Envelope) => Promise<void>): void;
  /** Tear down the adapter. Optional. */
  stop?(): Promise<void>;
}

/** Ack/nack and delivery attempt for one queue message. */
export interface QueueConsumeCtx {
  /** 1-based delivery attempt. */
  attempt: number;
  /** Mark this delivery succeeded. */
  ack: () => Promise<void>;
  /** Reject this delivery so it can retry. */
  nack: () => Promise<void>;
}

/** Work queue. One consumer in a group; ack/nack; `attempt`. */
export interface QueueAdapter {
  /** Discriminant. Must be `'queue'`. */
  kind: 'queue';
  /** Put one envelope on the queue. */
  publish(envelope: Envelope): Promise<void>;
  /** Register a competing consumer for one event key in `group`. */
  consume(
    key: string,
    group: string,
    handler: (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>,
  ): void;
  /** Tear down the adapter. Optional. */
  stop?(): Promise<void>;
}

/** Bound event transport: a bus or a queue. */
export type EventAdapter = BusAdapter | QueueAdapter;
