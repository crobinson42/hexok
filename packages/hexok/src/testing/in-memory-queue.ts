import type {
  Envelope,
  QueueAdapter,
  QueueConsumeCtx,
} from '../domain/index.js';

type Consumer = (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>;

/**
 * In-process queue. `consume` dispatches with attempt; ack/nack are no-ops.
 * `stop()` clears consumers.
 */
export class InMemoryQueue implements QueueAdapter {
  readonly kind = 'queue' as const;
  /** Envelopes passed to `publish`, in order. */
  readonly published: Envelope[] = [];
  #consumers = new Map<string, Map<string, Consumer>>();
  /** `attempt` passed to consumers on the next `publish`. Not a retry counter. */
  attempts = 1;

  /** Empty queue. Pass to `.bind(catalog, InMemoryQueue.create())`. */
  static create(): InMemoryQueue {
    return new InMemoryQueue();
  }

  /** Record the envelope and dispatch every consumer group for its key. */
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

  /** Register the consumer for `key`+`group`. Later calls replace that group. */
  consume(key: string, group: string, handler: Consumer): void {
    const groups = this.#consumers.get(key) ?? new Map<string, Consumer>();
    groups.set(group, handler);
    this.#consumers.set(key, groups);
  }

  /** Drop all consumers. Does not clear `published`. */
  async stop(): Promise<void> {
    this.#consumers.clear();
  }
}
