import { type EventInstance, Port } from 'hexok';
import type { DomainEvents } from '../../../domain/events/domain-events.js';

export abstract class DomainEventPublisher extends Port(
  'DomainEventPublisher',
) {
  abstract publish(event: EventInstance<typeof DomainEvents>): Promise<void>;
}
