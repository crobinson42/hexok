import { type EventInstance, Port } from 'hexok';
import type { DomainEvents } from '../events/domain.js';

/** Handler instance a process entry passes to {@link DomainEventSubscriptions}. */
export type DomainEventsSubscribedHandler = {
  handle(event: EventInstance<typeof DomainEvents>): Promise<void> | void;
};

export abstract class DomainEventSubscriptions extends Port(
  'DomainEventSubscriptions',
) {
  abstract subscribe(handlers: readonly DomainEventsSubscribedHandler[]): void;
}
