import type { Queue } from '@hexok/queue';
import { Adapter, type EventInstance } from 'hexok';
import { DomainEventPublisher } from '../../../app/ports/events/domain-event-publisher.js';
import { DomainEvents } from '../../../domain/events/domain-events.js';

export class QueueDomainEventPublisher extends Adapter(DomainEventPublisher) {
  constructor(private readonly deps: { queue: Queue }) {
    super();
  }

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    // Reject an event that is not in the catalog. The topic stays the event token.
    const message = DomainEvents.message(event);
    await this.deps.queue.publish(event.token, message.payload);
  }
}
