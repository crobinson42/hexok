import type { BusAdapter, Envelope } from '../domain/index.js';

/**
 * In-process bus. Records `published`. `stop()` clears subscribers.
 */
export class InMemoryBus implements BusAdapter {
  readonly kind = 'bus' as const;
  /** Envelopes passed to `publish`, in order. */
  readonly published: Envelope[] = [];
  #subscribers = new Map<
    string,
    Array<(envelope: Envelope) => Promise<void>>
  >();

  /** Empty bus. Pass to `.bind(catalog, InMemoryBus.create())`. */
  static create(): InMemoryBus {
    return new InMemoryBus();
  }

  /** Record the envelope, then await each subscriber for its key. */
  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
    for (const handler of this.#subscribers.get(envelope.key) ?? []) {
      await handler(envelope);
    }
  }

  /** Register a handler for `key`. Cleared by `stop()`. */
  subscribe(key: string, handler: (envelope: Envelope) => Promise<void>): void {
    const list = this.#subscribers.get(key) ?? [];
    list.push(handler);
    this.#subscribers.set(key, list);
  }

  /** Drop all subscribers. Does not clear `published`. */
  async stop(): Promise<void> {
    this.#subscribers.clear();
  }
}
