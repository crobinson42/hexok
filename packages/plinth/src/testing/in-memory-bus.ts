import type { BusAdapter, Envelope } from '../domain/index.js';

/**
 * In-process bus. Records `published`. `stop()` clears subscribers.
 */
export class InMemoryBus implements BusAdapter {
  readonly kind = 'bus' as const;
  readonly published: Envelope[] = [];
  #subscribers = new Map<
    string,
    Array<(envelope: Envelope) => Promise<void>>
  >();

  static create(): InMemoryBus {
    return new InMemoryBus();
  }

  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
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
  }
}
