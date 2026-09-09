import type { BusAdapter, Envelope } from '@plinth/domain';

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
    for (const handler of this.#subscribers.get(envelope.name) ?? []) {
      await handler(envelope);
    }
  }

  subscribe(
    name: string,
    handler: (envelope: Envelope) => Promise<void>,
  ): void {
    const list = this.#subscribers.get(name) ?? [];
    list.push(handler);
    this.#subscribers.set(name, list);
  }

  async stop(): Promise<void> {
    this.#subscribers.clear();
  }
}
