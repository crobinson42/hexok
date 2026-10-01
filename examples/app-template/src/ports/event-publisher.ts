import { type EventInstance, Port } from 'hexok';
import type { BlogEvents } from '../events/catalog.js';

export abstract class EventPublisher extends Port('EventPublisher') {
  abstract publish(event: EventInstance<typeof BlogEvents>): Promise<void>;
}
