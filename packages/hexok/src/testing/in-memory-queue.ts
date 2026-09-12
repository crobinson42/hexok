import type {
  Envelope,
  QueueAdapter,
  QueueConsumeCtx,
} from '../domain/index.js';

type Consumer = (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>;

/**
 * In-process queue. `nack` (or a throw) redelivers with `attempt + 1` up to
 * `maxAttempts` (default 3). `stop()` clears consumers.
 */
export class InMemoryQueue implements QueueAdapter {
  readonly kind = 'queue' as const;
  /** Envelopes passed to `publish`, in order (one entry per publish, not per attempt). */
  readonly published: Envelope[] = [];
  #consumers = new Map<string, Map<string, Consumer>>();
  /** Stop redelivering after this many attempts. */
  maxAttempts = 3;

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
      await this.#deliver(envelope, consumer, 1);
    }
  }

  async #deliver(
    envelope: Envelope,
    consumer: Consumer,
    attempt: number,
  ): Promise<void> {
    let outcome: 'ack' | 'nack' | 'none' = 'none';
    let thrown: unknown;
    const ctx: QueueConsumeCtx = {
      attempt,
      ack: async () => {
        outcome = 'ack';
      },
      nack: async () => {
        outcome = 'nack';
      },
    };
    try {
      await consumer(envelope, ctx);
    } catch (error) {
      thrown = error;
      if (outcome === 'none') outcome = 'nack';
    }
    if (outcome !== 'nack') return;
    if (attempt < this.maxAttempts) {
      await this.#deliver(envelope, consumer, attempt + 1);
      return;
    }
    if (thrown !== undefined) throw thrown;
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
