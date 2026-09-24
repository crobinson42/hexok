import { type EventMessage, Port } from 'hexok';
import type { DomainEvents } from '../events/domain.js';

export abstract class DomainEventPublisher extends Port(
  'DomainEventPublisher',
) {
  abstract publish(event: EventMessage<typeof DomainEvents>): Promise<void>;
}
