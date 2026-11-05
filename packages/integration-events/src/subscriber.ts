import type {
  Queue,
  QueueDisposition,
  QueueMaxDeliveries,
  QueueMessage,
  QueueStartFrom,
} from '@hexok/queue';
import { CodedError } from 'hexok';
import type { ContractDefinition, ContractMessage } from './contract.js';
import { metaOf, readEnvelope } from './envelope.js';
import type { MessageConstructor } from './message.js';

const servicePattern = /^[A-Za-z0-9_-]+$/;

/** Structural logger. `@hexok/logger` and `console` fit it. */
export interface LogSink {
  error(message: string | Error, fields?: Record<string, unknown>): void;
}

/** Structurally `Quarantine.park`. This package does not import `@hexok/quarantine`. */
export interface ParkInput {
  readonly source: string;
  readonly operation: string;
  readonly subject?: string;
  readonly payload: unknown;
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly code?: string;
  };
  readonly occurredAt: Date;
  readonly context?: Readonly<Record<string, string>>;
}

export interface ParkSink {
  park(input: ParkInput): Promise<{ id: string }>;
}

/**
 * A constructed `EventHandler` for a message in the contract. `handle` is
 * typed `never` so a mixed array still passes. `EventHandler` types the event.
 */
export interface IntegrationHandler<C extends ContractDefinition> {
  readonly token: string;
  readonly event: ContractMessage<C>;
  handle(event: never, meta: never): Promise<void> | void;
}

export interface SubscribeOptions<C extends ContractDefinition> {
  /** Passed to `Queue.subscribe` for each handler. */
  readonly maxDeliveries: QueueMaxDeliveries;
  /** Passed to `Queue.subscribe` for each handler. */
  readonly startFrom?: QueueStartFrom;
  readonly handlers: readonly IntegrationHandler<C>[];
}

/** One queue subscription that {@link IntegrationSubscriber.subscribe} made. */
export interface Subscription {
  readonly topic: string;
  readonly group: string;
  readonly type: string;
  readonly version: number;
}

interface Plan {
  readonly handler: Pick<IntegrationHandler<ContractDefinition>, 'handle'>;
  readonly message: MessageConstructor;
  readonly subscription: Subscription;
}

/**
 * Subscribes `EventHandler`s to a contract's topics through a `Queue`. Each
 * handler gets its own consumer group, `<service>:<handler token>`.
 *
 * ```ts
 * const billing = new IntegrationSubscriber(Billing, { queue, service: 'crm' });
 * await billing.subscribe({ maxDeliveries: 10, handlers: [new SyncInvoice(deps)] });
 * ```
 */
export class IntegrationSubscriber<C extends ContractDefinition> {
  readonly #contract: C;
  readonly #queue: Queue;
  readonly #service: string;
  readonly #logger: LogSink | undefined;
  readonly #quarantine: ParkSink | undefined;
  readonly #topicOf = new Map<MessageConstructor, string>();
  readonly #groups = new Set<string>();

  constructor(
    contract: C,
    deps: {
      readonly queue: Queue;
      /** Name of the consuming service. Prefixes every consumer group. */
      readonly service: string;
      readonly logger?: LogSink;
      readonly quarantine?: ParkSink;
    },
  ) {
    if (
      typeof deps.service !== 'string' ||
      !servicePattern.test(deps.service)
    ) {
      throw new Error(
        `integration-events: service "${String(deps.service)}" must match ${servicePattern}`,
      );
    }
    this.#contract = contract;
    this.#queue = deps.queue;
    this.#service = deps.service;
    this.#logger = deps.logger;
    this.#quarantine = deps.quarantine;
    for (const topic of Object.values(contract.topics)) {
      for (const message of topic.messages) {
        this.#topicOf.set(message, topic.name);
      }
    }
  }

  /**
   * Subscribe each handler to the topic of its message. Checks every handler
   * before it subscribes any. Throws when a handler's message is not in the
   * contract, or when two handlers would share a group on one topic.
   *
   * A delivery of another type or version is acked and skipped. A payload
   * that is not an envelope, or data its schema rejects, is logged, parked
   * when a quarantine sink is set, and dropped. A throw from `handle` follows
   * the queue's retry rules.
   */
  async subscribe(options: SubscribeOptions<C>): Promise<Subscription[]> {
    const plans = this.#plan(options.handlers);
    const subscriptions: Subscription[] = [];
    for (const plan of plans) {
      const { topic, group } = plan.subscription;
      await this.#queue.subscribe(topic, {
        consumerGroup: group,
        maxDeliveries: options.maxDeliveries,
        ...(options.startFrom !== undefined
          ? { startFrom: options.startFrom }
          : {}),
        handler: (message) => this.#deliver(plan, message),
      });
      this.#groups.add(groupKey(topic, group));
      subscriptions.push(plan.subscription);
    }
    return subscriptions;
  }

  #plan(handlers: readonly IntegrationHandler<C>[]): Plan[] {
    const planned = new Map<string, Plan>();
    for (const handler of handlers) {
      const message = handler.event as MessageConstructor;
      const topic = this.#topicOf.get(message);
      if (topic === undefined) {
        throw new Error(
          `integration-events: handler "${handler.token}" handles "${message.token}" v${message.version}, which is not in contract "${this.#contract.token}"`,
        );
      }
      const group = `${this.#service}:${handler.token}`;
      const key = groupKey(topic, group);
      const previous = planned.get(key);
      if (previous !== undefined || this.#groups.has(key)) {
        throw new Error(
          `integration-events: group "${group}" on topic "${topic}" is already subscribed. Give each handler its own token`,
        );
      }
      planned.set(key, {
        handler,
        message,
        subscription: {
          topic,
          group,
          type: message.token,
          version: message.version,
        },
      });
    }
    return [...planned.values()];
  }

  async #deliver(
    plan: Plan,
    delivery: QueueMessage<unknown>,
  ): Promise<QueueDisposition> {
    const envelope = readEnvelope(delivery.payload);
    if (envelope === undefined) {
      await this.#reject(
        plan,
        delivery,
        new Error('integration-events: entry is not an integration event'),
      );
      return 'drop';
    }
    const { message } = plan;
    if (
      envelope.type !== message.token ||
      envelope.version !== message.version
    ) {
      return 'ack';
    }

    let event: object;
    try {
      event = message.parse(envelope.data);
    } catch (error) {
      if (error instanceof CodedError && error.code === 'VALIDATION') {
        await this.#reject(plan, delivery, error);
        return 'drop';
      }
      throw error;
    }
    await plan.handler.handle(event as never, metaOf(envelope) as never);
    return 'ack';
  }

  async #reject(
    plan: Plan,
    delivery: QueueMessage<unknown>,
    error: Error,
  ): Promise<void> {
    const { topic, group } = plan.subscription;
    this.#logger?.error(error, { topic, group, id: delivery.id });
    if (this.#quarantine === undefined) return;
    try {
      await this.#quarantine.park({
        source: 'integration-events',
        operation: 'deliver',
        subject: `${topic}:${delivery.id}`,
        payload: delivery.payload,
        error:
          error instanceof CodedError
            ? { name: error.name, message: error.message, code: error.code }
            : { name: error.name, message: error.message },
        occurredAt: new Date(),
        context: { group },
      });
    } catch (parkError) {
      this.#logger?.error(
        parkError instanceof Error
          ? parkError
          : new Error('integration-events: park failed'),
        { topic, group, id: delivery.id },
      );
    }
  }
}

function groupKey(topic: string, group: string): string {
  return `${topic}\0${group}`;
}
