import type { EventInstance } from 'hexok';
import { ClientEvents } from '../../domain/events/client-events.js';

const catalogTokens = new Set<string>(
  Object.values(ClientEvents.events).map((event) => event.token),
);

export type ClientSend = (text: string) => void;

/**
 * Connected clients and the tokens they subscribed to.
 * A later rule for which client receives an event belongs in {@link ClientSockets.deliver}.
 */
export class ClientSockets {
  readonly #clients = new Set<Client>();

  connect(send: ClientSend): Client {
    const client = new Client(send, (closed) => {
      this.#clients.delete(closed);
    });
    this.#clients.add(client);
    return client;
  }

  close(client: Client): void {
    client.close();
  }

  deliver(event: EventInstance<typeof ClientEvents>): void {
    const message = ClientEvents.message(event);
    const frame = JSON.stringify({
      type: 'event',
      token: event.token,
      key: message.key,
      payload: message.payload,
    });
    for (const client of this.#clients) {
      if (!client.wants(event.token)) continue;
      try {
        client.send(frame);
      } catch {
        // One dead socket must not stop the others.
      }
    }
  }
}

export class Client {
  #open = true;
  #all = false;
  readonly #events = new Set<string>();

  constructor(
    private readonly write: ClientSend,
    private readonly onClose: (client: Client) => void,
  ) {}

  handle(raw: string): void {
    if (!this.#open) return;
    const message = parseClientMessage(raw);
    if (!message.ok) {
      this.fail(message.error);
      return;
    }
    if (message.type === 'subscribe') {
      this.#subscribe(message.events);
      return;
    }
    this.#unsubscribe(message.events);
  }

  fail(message: string): void {
    if (!this.#open) return;
    this.write(JSON.stringify({ type: 'error', message }));
  }

  wants(token: string): boolean {
    return this.#open && (this.#all || this.#events.has(token));
  }

  send(text: string): void {
    if (!this.#open) return;
    this.write(text);
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#all = false;
    this.#events.clear();
    this.onClose(this);
  }

  #subscribe(events: 'all' | readonly string[]): void {
    if (events === 'all') {
      this.#all = true;
      this.#events.clear();
      this.#ack();
      return;
    }
    if (!this.#all) {
      for (const token of events) this.#events.add(token);
    }
    this.#ack();
  }

  #unsubscribe(events: 'all' | readonly string[]): void {
    if (events === 'all') {
      this.#all = false;
      this.#events.clear();
      this.#ack();
      return;
    }
    if (this.#all) {
      this.#all = false;
      this.#events.clear();
      for (const token of catalogTokens) {
        if (!events.includes(token)) this.#events.add(token);
      }
    } else {
      for (const token of events) this.#events.delete(token);
    }
    this.#ack();
  }

  #ack(): void {
    this.write(
      JSON.stringify({
        type: 'subscribed',
        events: this.#all ? ['*'] : [...this.#events],
      }),
    );
  }
}

type ClientMessage =
  | { ok: true; type: 'subscribe' | 'unsubscribe'; events: 'all' | string[] }
  | { ok: false; error: string };

function parseClientMessage(raw: string): ClientMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid json' };
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { ok: false, error: 'expected { type }' };
  }
  if (value.type !== 'subscribe' && value.type !== 'unsubscribe') {
    return { ok: false, error: `unknown type "${value.type}"` };
  }
  const events = readEvents(value.events);
  if (!events.ok) return events;
  return { ok: true, type: value.type, events: events.tokens };
}

function readEvents(
  value: unknown,
): { ok: true; tokens: 'all' | string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, tokens: 'all' };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'events must be an array of event tokens' };
  }
  const tokens: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item === '') {
      return { ok: false, error: 'events must be an array of event tokens' };
    }
    if (!catalogTokens.has(item)) {
      return { ok: false, error: `unknown event "${item}"` };
    }
    tokens.push(item);
  }
  return { ok: true, tokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
