import { Adapter, type EventInstance } from 'hexok';
import { DomainEvents } from '../events/domain-catalog.js';
import { DomainEventPublisher } from '../ports/domain-event-publisher.js';
import {
  DomainEventSubscriptions,
  type DomainEventsSubscribedHandler,
} from '../ports/domain-event-subscriptions.js';

export type DeliveryFailure = {
  token: string;
  groupId: string;
  error: unknown;
};

type Binding = {
  token: string;
  groupId: string;
  event: new (...args: never[]) => object;
  handler: DomainEventsSubscribedHandler;
};

/** In-memory broker shared by the publisher and the subscriptions adapter. */
class EventLog {
  readonly published: EventInstance<typeof DomainEvents>[] = [];
  readonly failures: DeliveryFailure[] = [];
  #bindings: Binding[] = [];
  #started = false;

  subscribe(handlers: readonly DomainEventsSubscribedHandler[]): void {
    const seen = new Set(this.#bindings.map((binding) => binding.groupId));
    const next: Binding[] = [];
    for (const handler of handlers) {
      const binding = bindingFrom(handler);
      if (seen.has(binding.groupId)) {
        throw new Error(`groupId "${binding.groupId}" is already subscribed`);
      }
      seen.add(binding.groupId);
      next.push(binding);
    }
    this.#bindings.push(...next);
  }

  start(): void {
    this.#started = true;
  }

  stop(): void {
    this.#started = false;
  }

  async publish(event: EventInstance<typeof DomainEvents>): Promise<void> {
    this.published.push(event);
    if (this.#bindings.length === 0) return;
    if (!this.#started) {
      throw new Error(
        'Domain event subscribers are registered. Call start() before publish().',
      );
    }
    const parsed = DomainEvents.parse(DomainEvents.message(event));
    for (const binding of this.#bindings) {
      if (!(parsed instanceof binding.event)) continue;
      try {
        await binding.handler.handle(parsed);
      } catch (error) {
        this.failures.push({
          token: binding.token,
          groupId: binding.groupId,
          error,
        });
      }
    }
  }
}

const logs = new WeakMap<
  InMemoryEventPublisher | InMemoryEventSubscriptions,
  EventLog
>();

function logOf(
  adapter: InMemoryEventPublisher | InMemoryEventSubscriptions,
): EventLog {
  const log = logs.get(adapter);
  if (log === undefined) {
    throw new Error('in-memory events adapter has no log');
  }
  return log;
}

export class InMemoryEventPublisher extends Adapter(DomainEventPublisher) {
  constructor() {
    super();
    logs.set(this, new EventLog());
  }

  get published(): EventInstance<typeof DomainEvents>[] {
    return logOf(this).published;
  }

  get failures(): DeliveryFailure[] {
    return logOf(this).failures;
  }

  async publish(event: EventInstance<typeof DomainEvents>): Promise<void> {
    await logOf(this).publish(event);
  }
}

export class InMemoryEventSubscriptions extends Adapter(
  DomainEventSubscriptions,
) {
  constructor(publisher: InMemoryEventPublisher) {
    super();
    logs.set(this, logOf(publisher));
  }

  subscribe(handlers: readonly DomainEventsSubscribedHandler[]): void {
    logOf(this).subscribe(handlers);
  }

  override async start(): Promise<void> {
    logOf(this).start();
  }

  override async stop(): Promise<void> {
    logOf(this).stop();
  }
}

/** One log, two ports. */
export function inMemoryEvents(): {
  publisher: InMemoryEventPublisher;
  subscriptions: InMemoryEventSubscriptions;
} {
  const publisher = new InMemoryEventPublisher();
  return {
    publisher,
    subscriptions: new InMemoryEventSubscriptions(publisher),
  };
}

function bindingFrom(handler: DomainEventsSubscribedHandler): Binding {
  const source = handler.constructor as {
    name?: string;
    token?: unknown;
    groupId?: unknown;
    event?: unknown;
  };
  const name =
    typeof source.name === 'string' && source.name.length > 0
      ? source.name
      : 'handler';
  if (typeof source.groupId !== 'string' || source.groupId.length === 0) {
    throw new Error(`${name} declares no groupId`);
  }
  if (typeof source.token !== 'string' || source.token.length === 0) {
    throw new Error(`${name} declares no token`);
  }
  if (typeof source.event !== 'function') {
    throw new Error(`${name} declares no event`);
  }
  return {
    token: source.token,
    groupId: source.groupId,
    event: source.event as new (...args: never[]) => object,
    handler,
  };
}
