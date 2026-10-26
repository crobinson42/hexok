import { type Broadcast, channel } from '@hexok/broadcast';
import { Adapter, type EventInstance, type EventMessage } from 'hexok';
import { ClientEventPublisher } from '../../../app/ports/events/client-event-publisher.js';
import { ClientEvents } from '../../../domain/events/client-events.js';

export const clientEventsChannel =
  channel<EventMessage<typeof ClientEvents>>('client-events');

/**
 * TODO: we need to explore and probably refactor where the domain/app layer perform the business
 * logic of who/which connected clients should receive the event - ie: multi-tenancy
 */
export class BroadcastClientEventPublisher extends Adapter(
  ClientEventPublisher,
) {
  constructor(private readonly deps: { broadcast: Broadcast }) {
    super();
  }

  override async publish(
    event: EventInstance<typeof ClientEvents>,
  ): Promise<void> {
    await this.deps.broadcast.publish(
      clientEventsChannel,
      ClientEvents.message(event),
    );
  }
}
