import type { BrokerAdapter, BrokerConsumeCtx, Envelope } from '@plinth/domain';

type Consumer = (envelope: Envelope, ctx: BrokerConsumeCtx) => Promise<void>;

/**
 * In-process broker. `consume` dispatches with attempt; ack/nack are no-ops
 * besides recording. `stop()` clears consumers.
 */
export class InMemoryBroker implements BrokerAdapter {
  readonly kind = 'broker' as const;
  readonly published: Envelope[] = [];
  #consumers = new Map<string, Map<string, Consumer>>();
  attempts = 1;

  static create(): InMemoryBroker {
    return new InMemoryBroker();
  }

  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
    const groups = this.#consumers.get(envelope.name);
    if (!groups) return;
    for (const consumer of groups.values()) {
      let acked = false;
      const ctx: BrokerConsumeCtx = {
        attempt: this.attempts,
        ack: async () => {
          acked = true;
        },
        nack: async () => {
          acked = false;
        },
      };
      await consumer(envelope, ctx);
      void acked;
    }
  }

  consume(name: string, group: string, handler: Consumer): void {
    const groups = this.#consumers.get(name) ?? new Map<string, Consumer>();
    groups.set(group, handler);
    this.#consumers.set(name, groups);
  }

  async stop(): Promise<void> {
    this.#consumers.clear();
  }
}
