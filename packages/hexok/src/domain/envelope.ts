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
  key: K;
  payload: P;
  catalog: Cat;
  kind: Kind;
  occurredAt: Date;
  ctx?: Ctx;
  correlationId?: string;
  causationId?: string;
  meta: Record<string, unknown>;
};

/** Fire-and-forget pub/sub. No ack, no consumer group, no persistence in the contract. */
export interface BusAdapter {
  kind: 'bus';
  publish(envelope: Envelope): Promise<void>;
  subscribe(key: string, handler: (envelope: Envelope) => Promise<void>): void;
  stop?(): Promise<void>;
}

export interface QueueConsumeCtx {
  attempt: number;
  ack: () => Promise<void>;
  nack: () => Promise<void>;
}

/** Work queue. One consumer in a group; ack/nack; `attempt`. */
export interface QueueAdapter {
  kind: 'queue';
  publish(envelope: Envelope): Promise<void>;
  consume(
    key: string,
    group: string,
    handler: (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>,
  ): void;
  stop?(): Promise<void>;
}

export type EventAdapter = BusAdapter | QueueAdapter;
