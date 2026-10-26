import { type EventInstance, Port } from 'hexok';
import type { ClientEvents } from '../../../domain/events/client-events.js';

export abstract class ClientEventPublisher extends Port(
  'ClientEventPublisher',
) {
  abstract publish(event: EventInstance<typeof ClientEvents>): Promise<void>;
}
