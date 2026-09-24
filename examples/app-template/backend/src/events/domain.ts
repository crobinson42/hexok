import { EventCatalog } from 'hexok';
import { UserCreatedEvent } from './user-created.js';

export class DomainEvents extends EventCatalog('domain', {
  userCreated: UserCreatedEvent,
}) {}
