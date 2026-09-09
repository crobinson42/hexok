export type CatalogKind = 'bus' | 'broker';

/**
 * Runtime value on the wire. `kind` is copied from the catalog.
 */
export type Envelope<
  N extends string = string,
  P = unknown,
  Cat extends string = string,
  Kind extends CatalogKind = CatalogKind,
> = {
  name: N;
  payload: P;
  catalog: Cat;
  kind: Kind;
  occurredAt: Date;
  correlationId?: string;
  causationId?: string;
  meta: Record<string, unknown>;
};

export interface BusAdapter {
  kind: 'bus';
  publish(envelope: Envelope): Promise<void>;
  subscribe(name: string, handler: (envelope: Envelope) => Promise<void>): void;
  stop?(): Promise<void>;
}

export interface BrokerConsumeCtx {
  attempt: number;
  ack: () => Promise<void>;
  nack: () => Promise<void>;
}

export interface BrokerAdapter {
  kind: 'broker';
  publish(envelope: Envelope): Promise<void>;
  consume(
    name: string,
    group: string,
    handler: (envelope: Envelope, ctx: BrokerConsumeCtx) => Promise<void>,
  ): void;
  stop?(): Promise<void>;
}

export type EventAdapter = BusAdapter | BrokerAdapter;
