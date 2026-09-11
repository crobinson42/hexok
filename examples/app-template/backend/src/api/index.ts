import { App } from 'hexok/runtime';
import { InMemoryBroker, InMemoryRepository } from 'hexok/testing';
import type { AppContext } from '../app/context.js';
import { ClientEvents } from '../app/events/client/catalog.js';
import { ApiKeyRepository } from '../app/ports/repos/api-keys.js';
import { OrganizationRepository } from '../app/ports/repos/organizations.js';
import { UserCredentialsRepository } from '../app/ports/repos/user-credentials.js';
import { UserRepository } from '../app/ports/repos/users.js';
import { AuthTokenService } from '../app/ports/services/auth-token.js';
import { EmailService } from '../app/ports/services/email.js';
import { PasswordHasher } from '../app/ports/utilities/password-hasher.js';
import { useCases } from '../app/use-cases/index.js';
import { DomainEvents } from '../domain/events/domain/catalog.js';
import {
  type ClientConnection,
  WebSocketClientBus,
} from '../infra/client-event-bus/index.js';
import { createHandler } from './http.js';
import {
  memoryApiKeys,
  memoryUserCredentials,
  memoryUsers,
  stubEmail,
  stubPasswordHasher,
  stubToken,
} from './stubs.js';
import { acceptClient } from './ws.js';

export type { ClientConnection } from '../infra/client-event-bus/index.js';
export { WebSocketClientBus } from '../infra/client-event-bus/index.js';
export { createHandler, publicRoutes } from './http.js';
export {
  memoryApiKeys,
  memoryUserCredentials,
  memoryUsers,
  stubEmail,
  stubPasswordHasher,
  stubToken,
} from './stubs.js';
export { acceptClient, tokenFromRequest } from './ws.js';

export function createApi() {
  const token = stubToken();
  const clientBus = WebSocketClientBus.create();
  const app = App.from(useCases)
    .provide(
      OrganizationRepository,
      InMemoryRepository.of(OrganizationRepository, { keyBy: 'id' }),
    )
    .provide(UserRepository, memoryUsers())
    .provide(UserCredentialsRepository, memoryUserCredentials())
    .provide(ApiKeyRepository, memoryApiKeys())
    .provide(EmailService, stubEmail())
    .provide(PasswordHasher, stubPasswordHasher())
    .provide(AuthTokenService, token)
    .bind(DomainEvents, InMemoryBroker.create())
    .bind(ClientEvents, clientBus)
    .ctx<AppContext>({})
    .build();

  return {
    app,
    fetch: createHandler(app, token),
    clientBus,
    accept: (connection: ClientConnection, request: Request) =>
      acceptClient(connection, request, token, clientBus),
  };
}
