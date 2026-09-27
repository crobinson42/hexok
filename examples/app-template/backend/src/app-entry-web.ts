import { InMemoryUsers } from './adapters/in-memory-users.js';
import { IndexUserHandler } from './handlers/index-user.js';
import { SendWelcomeEmailHandler } from './handlers/send-welcome-email.js';
import type { DomainEventPublisher } from './ports/domain-event-publisher.js';
import type { DomainEventSubscriptions } from './ports/domain-event-subscriptions.js';
import type { EmailSender } from './ports/email-sender.js';
import type { SearchIndex } from './ports/search-index.js';
import type { UserRepository } from './ports/user-repository.js';
import { CreateUser } from './use-cases/api/protected/create-user.js';

/** Web process. Publishes user facts and subscribes the light handlers. */
export function createWebApp(deps: {
  publisher: DomainEventPublisher;
  subscriptions: DomainEventSubscriptions;
  email: EmailSender;
  search: SearchIndex;
  users?: UserRepository;
}) {
  const users = deps.users ?? new InMemoryUsers();
  deps.subscriptions.subscribe([
    new SendWelcomeEmailHandler(deps.email),
    new IndexUserHandler(deps.search),
  ]);
  return {
    publisher: deps.publisher,
    subscriptions: deps.subscriptions,
    users,
    createUser: new CreateUser({
      domainEventPublisher: deps.publisher,
      users,
    }),
  };
}
