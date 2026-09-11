import type {
  Envelope,
  QueueAdapter,
  QueueConsumeCtx,
} from '../domain/index.js';

type Consumer = (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>;

/**
 * In-process queue. `consume` dispatches with attempt; ack/nack are no-ops
 * besides recording. `stop()` clears consumers.
 */
export class InMemoryQueue implements QueueAdapter {
  readonly kind = 'queue' as const;
  readonly published: Envelope[] = [];
  #consumers = new Map<string, Map<string, Consumer>>();
  attempts = 1;

  static create(): InMemoryQueue {
    return new InMemoryQueue();
  }

  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
    const groups = this.#consumers.get(envelope.key);
    if (!groups) return;
    for (const consumer of groups.values()) {
      let acked = false;
      const ctx: QueueConsumeCtx = {
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

  consume(key: string, group: string, handler: Consumer): void {
    const groups = this.#consumers.get(key) ?? new Map<string, Consumer>();
    groups.set(group, handler);
    this.#consumers.set(key, groups);
  }

  async stop(): Promise<void> {
    this.#consumers.clear();
  }
}
