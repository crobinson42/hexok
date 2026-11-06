import { randomUUID } from 'node:crypto';
import type { Queue } from '@hexok/queue';
import { validate, validationError } from 'hexok';
import type { ContractDefinition, ContractEvent } from './contract.js';
import type { IntegrationEnvelope } from './envelope.js';
import type { Downgrade, MessageConstructor } from './message.js';

/** Envelope attributes the caller may set. */
export interface PublishOptions {
  /** Defaults to a random UUID. Pass a stable id, such as an outbox row id, so a retry carries the same id. */
  readonly id?: string;
  /** Defaults to now. */
  readonly time?: Date;
  /** Such as the aggregate id. Omitted from the envelope when unset. */
  readonly subject?: string;
}

/**
 * Publishes a contract's messages to its topics through a `Queue`.
 *
 * ```ts
 * const billing = new IntegrationPublisher(Billing, { queue });
 * await billing.publish(new InvoicePaid({ invoiceId, amountCents }));
 * ```
 */
export class IntegrationPublisher<C extends ContractDefinition> {
  readonly #source: string;
  readonly #queue: Queue;
  readonly #topicOf = new Map<MessageConstructor, string>();
  readonly #superseded = new Set<MessageConstructor>();

  constructor(contract: C, deps: { readonly queue: Queue }) {
    this.#source = contract.token;
    this.#queue = deps.queue;
    for (const topic of Object.values(contract.topics)) {
      for (const message of topic.messages) {
        this.#topicOf.set(message, topic.name);
        const to = message.downgrade?.to;
        if (to !== undefined) this.#superseded.add(to);
      }
    }
  }

  /**
   * Validate the payload, then publish it and one downgraded copy for each
   * earlier version in the topic, newest first. Every copy has the same `id`,
   * `time`, and `subject`. Resolves the `id`.
   *
   * Each payload is validated in its JSON form, the form the queue carries,
   * and that JSON form is what is sent, so a consumer parsing it with the
   * same schema accepts it. A `Date` arrives as a string, so a `z.date()`
   * field fails here and not at every consumer.
   *
   * Throws when the message is not in the contract, or when it has a newer
   * version. Throws `CodedError` `VALIDATION` before publishing anything when
   * a payload or a downgraded payload is not JSON or fails its schema. A
   * queue failure rejects, and copies already published stay published.
   */
  async publish(
    event: ContractEvent<C>,
    options: PublishOptions = {},
  ): Promise<string> {
    const instance = event as { readonly payload: unknown };
    const Newest = instance.constructor as MessageConstructor;
    const topic = this.#topicOf.get(Newest);
    if (topic === undefined) {
      throw new Error(
        `integration-events: ${describe(event)} is not in contract "${this.#source}"`,
      );
    }
    if (this.#superseded.has(Newest)) {
      throw new Error(
        `integration-events: ${describe(event)} has a newer version in topic "${topic}"`,
      );
    }

    const versions = chain(Newest, instance.payload);
    const id = options.id ?? randomUUID();
    const time = (options.time ?? new Date()).toISOString();
    for (const { message, payload } of versions) {
      const envelope: IntegrationEnvelope = {
        specversion: '1.0',
        id,
        source: this.#source,
        type: message.token,
        version: message.version,
        time,
        ...(options.subject !== undefined ? { subject: options.subject } : {}),
        data: payload,
      };
      await this.#queue.publish(topic, envelope);
    }
    return id;
  }
}

/**
 * The payload at each version, newest first. Each version's JSON copy is
 * validated and sent. The schema's output is the input to the next downgrade.
 */
function chain(
  newest: MessageConstructor,
  payload: unknown,
): Array<{ message: MessageConstructor; payload: unknown }> {
  const versions: Array<{ message: MessageConstructor; payload: unknown }> = [];
  let message: MessageConstructor | undefined = newest;
  let current = payload;
  while (message !== undefined) {
    const json = toJson(message, current);
    const parsed = validate(message.schema, json);
    if (!parsed.ok) {
      throw validationError(
        `integration-events: ${describe(message)} validation failed`,
        parsed.issues,
      );
    }
    versions.push({ message, payload: json });
    const downgrade: Downgrade | undefined = message.downgrade;
    if (downgrade === undefined) break;
    current = downgrade.map(parsed.value as never);
    message = downgrade.to;
  }
  return versions;
}

/** The payload after a JSON round trip. Throws `VALIDATION` when it has no JSON form, such as a `bigint` or a cycle. */
function toJson(message: MessageConstructor, payload: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : '';
    throw validationError(
      `integration-events: ${describe(message)} payload is not JSON${reason}`,
    );
  }
}

function describe(event: object): string {
  const { token, version } = event as {
    readonly token?: unknown;
    readonly version?: unknown;
  };
  return `"${String(token)}" v${String(version)}`;
}
