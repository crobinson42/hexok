import { type EventInstance, Port } from 'hexok';
import type { BlogEvents } from '../events/catalog.js';

export type SubscribedHandler = {
  handle(event: EventInstance<typeof BlogEvents>): Promise<void> | void;
};

export abstract class EventSubscriptions extends Port('EventSubscriptions') {
  abstract subscribe(handlers: readonly SubscribedHandler[]): void;
}
