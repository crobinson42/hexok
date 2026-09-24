import { InMemoryUsers } from './adapters/in-memory-users.js';
import { DomainEvents } from './events/domain.js';
import type { UserRepository } from './ports/user-repository.js';
import { CreateUser } from './use-cases/create-user.js';

/** Application wiring. Hexok does not own this. */
export function createApp(users: UserRepository = new InMemoryUsers()) {
  return {
    users,
    createUser: new CreateUser(users),
    events: DomainEvents,
  };
}
