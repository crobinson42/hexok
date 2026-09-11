import type { BusAdapter, Envelope } from 'hexok/domain';
import type { Actor } from '../../domain/schemas/actor.js';
import type {ClientEventCtx} from "../../app/context.js";

export type ClientConnection = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'close', listener: () => void): void;
};

type Client = { actor: Actor; connection: ClientConnection };

export class WebSocketClientBus implements BusAdapter {
  readonly kind = 'bus' as const;
  readonly published: Envelope[] = [];
  #clients = new Set<Client>();
  #subscribers = new Map<
    string,
    Array<(envelope: Envelope) => Promise<void>>
  >();

  static create(): WebSocketClientBus {
    return new WebSocketClientBus();
  }

  connect(actor: Actor, connection: ClientConnection): void {
    const client: Client = { actor, connection };
    this.#clients.add(client);
    connection.addEventListener('close', () => {
      this.#clients.delete(client);
    });
  }

  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
    const body = serialize(envelope);
    for (const client of this.#clients) {
      if (!visibleTo(client.actor, envelope.ctx)) continue;
      try {
        client.connection.send(body);
      } catch {
        this.#clients.delete(client);
      }
    }
    for (const handler of this.#subscribers.get(envelope.key) ?? []) {
      await handler(envelope);
    }
  }

  subscribe(key: string, handler: (envelope: Envelope) => Promise<void>): void {
    const list = this.#subscribers.get(key) ?? [];
    list.push(handler);
    this.#subscribers.set(key, list);
  }

  async stop(): Promise<void> {
    this.#subscribers.clear();
    for (const { connection } of this.#clients) connection.close();
    this.#clients.clear();
  }
}

function serialize(envelope: Envelope): string {
  return JSON.stringify({
    key: envelope.key,
    catalog: envelope.catalog,
    payload: envelope.payload,
    occurredAt: envelope.occurredAt,
    ctx: envelope.ctx,
  });
}

function visibleTo(actor: Actor, ctx: unknown): boolean {
  if (!isClientCtx(ctx)) return false;
  if (ctx.kind === 'authenticated') return true;
  if (ctx.kind === 'user') return ctx.userIds.includes(actor.userId);
  return ctx.organizationIds.some((id) => actor.organizationIds.includes(id));
}

function isClientCtx(value: unknown): value is ClientEventCtx {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const kind = (value as { kind: unknown }).kind;
  if (kind === 'authenticated') return true;
  if (kind === 'user') {
    return Array.isArray((value as { userIds?: unknown }).userIds);
  }
  if (kind === 'organization') {
    return Array.isArray(
      (value as { organizationIds?: unknown }).organizationIds,
    );
  }
  return false;
}
