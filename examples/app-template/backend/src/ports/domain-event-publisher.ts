import { type EventInstance, Port } from 'hexok';
import type { DomainEvents } from '../events/domain-catalog.js';

export abstract class DomainEventPublisher extends Port(
  'DomainEventPublisher',
) {
  abstract publish(event: EventInstance<typeof DomainEvents>): Promise<void>;
}
