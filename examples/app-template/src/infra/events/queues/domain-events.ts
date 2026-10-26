import type { Queue } from '@hexok/queue';
import { Adapter, type EventInstance } from 'hexok';
import { DomainEventPublisher } from '../../../app/ports/events/domain-event-publisher.js';
import type { DomainEvents } from '../../../domain/events/domain-events.js';

export class QueueDomainEventPublisher extends Adapter(DomainEventPublisher) {
  constructor(private readonly deps: { queue: Queue }) {
    super();
  }

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    await this.deps.queue.publish(event.token, event.payload);
  }
}
