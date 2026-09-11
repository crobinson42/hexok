import { App } from 'plinth/runtime';
import { InMemoryBroker, InMemoryRepository } from 'plinth/testing';
import type { AppContext } from '../app/context.js';
import { ApiKeyRepository } from '../app/ports/repos/api-keys-repo.js';
import { EmailService } from '../app/ports/services/email.js';
import { OrganizationRepository } from '../app/ports/repos/organizations-repo.js';
import { PasswordHasher } from '../app/ports/utilities/password-hasher.js';
import { AuthTokenService } from '../app/ports/services/authTokenService.js';
import { UserCredentialsRepository } from '../app/ports/repos/user-credentials-repo.js';
import { UserRepository } from '../app/ports/repos/users-repo.js';
import { useCases } from '../app/use-cases/index.js';
import { DomainEvents } from '../domain/events/index.js';
import { createHandler } from './http.js';
import {
  memoryApiKeys,
  memoryUserCredentials,
  memoryUsers,
  stubEmail,
  stubPasswordHasher,
  stubToken,
} from './stubs.js';

export { createHandler, publicRoutes } from './http.js';
export {
  memoryApiKeys,
  memoryUserCredentials,
  memoryUsers,
  stubEmail,
  stubPasswordHasher,
  stubToken,
} from './stubs.js';

export function createApi() {
  const token = stubToken();
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
    .ctx<AppContext>({})
    .build();

  return { app, fetch: createHandler(app, token) };
}
