import type { MessageConstructor } from './message.js';

const namePattern = /^[A-Za-z0-9_-]+$/;

/** A topic as a {@link Contract} stores it. `name` is the queue topic. */
export interface ContractTopic<
  Name extends string = string,
  Messages extends
    readonly MessageConstructor[] = readonly MessageConstructor[],
> {
  readonly name: Name;
  readonly messages: Messages;
}

/** What `IntegrationPublisher` and `IntegrationSubscriber` read. */
export interface ContractDefinition {
  readonly token: string;
  readonly topics: Readonly<Record<string, ContractTopic>>;
}

type ResolvedTopics<
  Name extends string,
  Topics extends Record<string, readonly MessageConstructor[]>,
> = {
  readonly [K in keyof Topics & string]: ContractTopic<
    `${Name}.${K}`,
    Topics[K]
  >;
};

/** Every message class in a contract. */
export type ContractMessage<C extends ContractDefinition> =
  C['topics'][keyof C['topics']]['messages'][number];

type Superseded<M> = M extends {
  readonly downgrade: { readonly to: infer To };
}
  ? To
  : never;

/**
 * Instance of a message a publisher accepts: every message in the contract
 * except a version that a newer version downgrades to.
 *
 * ```ts
 * abstract publish(event: ContractEvent<typeof Billing>): Promise<string>
 * ```
 */
export type ContractEvent<C extends ContractDefinition> = InstanceType<
  Exclude<ContractMessage<C>, Superseded<ContractMessage<C>>>
>;

/**
 * The published events of one product. Each key is a topic. Its queue topic is
 * `<name>.<key>`. Each message class belongs to one topic. Versions of one type
 * in a topic form a chain, where each version downgrades to the one before it.
 *
 * ```ts
 * class Billing extends Contract('billing', {
 *   invoices: [InvoicePaid, InvoiceVoided],
 * }) {}
 * ```
 */
export function Contract<
  const Name extends string,
  const Topics extends Record<string, readonly MessageConstructor[]>,
>(name: Name, topics: Topics) {
  assertName('contract', name);
  const owner = new Map<MessageConstructor, string>();
  const resolved: Record<string, ContractTopic> = {};

  for (const [key, messages] of Object.entries(topics)) {
    assertName('topic', key);
    const topic = `${name}.${key}`;
    if (messages.length === 0) {
      throw new Error(`integration-events: topic "${topic}" has no messages`);
    }
    for (const message of messages) {
      assertMessage(topic, message);
      const previous = owner.get(message);
      if (previous !== undefined) {
        throw new Error(
          `integration-events: "${message.token}" v${message.version} is in topics "${previous}" and "${topic}"`,
        );
      }
      owner.set(message, topic);
    }
    assertVersionChains(topic, messages);
    resolved[key] = Object.freeze({
      name: topic,
      messages: Object.freeze([...messages]),
    });
  }

  const frozen = Object.freeze(resolved) as ResolvedTopics<Name, Topics>;

  abstract class ContractClass {
    /** Contract name. The envelope `source` and the queue topic prefix. */
    static readonly token: Name = name;
    /** Topics by key. Each has its queue topic `name` and its `messages`. */
    static readonly topics: ResolvedTopics<Name, Topics> = frozen;
  }

  return ContractClass;
}

function assertName(kind: 'contract' | 'topic', name: string): void {
  if (typeof name !== 'string' || !namePattern.test(name)) {
    throw new Error(
      `integration-events: ${kind} name "${String(name)}" must match ${namePattern}`,
    );
  }
}

function assertMessage(topic: string, message: unknown): void {
  const candidate = message as {
    readonly token?: unknown;
    readonly version?: unknown;
  };
  if (
    typeof message !== 'function' ||
    typeof candidate.token !== 'string' ||
    typeof candidate.version !== 'number' ||
    !('downgrade' in candidate)
  ) {
    throw new Error(
      `integration-events: topic "${topic}" holds a class that is not a Message`,
    );
  }
}

function assertVersionChains(
  topic: string,
  messages: readonly MessageConstructor[],
): void {
  const byType = new Map<string, MessageConstructor[]>();
  for (const message of messages) {
    const versions = byType.get(message.token) ?? [];
    versions.push(message);
    byType.set(message.token, versions);
  }

  for (const [type, versions] of byType) {
    versions.sort((a, b) => a.version - b.version);
    versions.forEach((message, index) => {
      const previous = versions[index - 1];
      if (previous?.version === message.version) {
        throw new Error(
          `integration-events: "${type}" v${message.version} is in topic "${topic}" twice`,
        );
      }
      const to = message.downgrade?.to;
      if (previous === undefined && to !== undefined) {
        throw new Error(
          `integration-events: "${type}" v${message.version} downgrades to v${to.version}, which is not in topic "${topic}"`,
        );
      }
      if (previous !== undefined && to !== previous) {
        throw new Error(
          `integration-events: "${type}" v${message.version} must downgrade to the v${previous.version} in topic "${topic}"`,
        );
      }
    });
  }
}
