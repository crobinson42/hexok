export {
  acceptClient,
  type ClientConnection,
  createApi,
  createHandler,
  publicRoutes,
  tokenFromRequest,
  WebSocketChannel,
} from './api/index.js';
export { requireUser } from './app/auth.js';
export { ClientChannel, visibleTo } from './app/channels/client-channel.js';
export type { AppContext } from './app/context.js';
export { ClientEvents } from './app/events/client/catalog.js';
export {
  ApiKeyRepository,
  AuthTokenService,
  EmailService,
  OrganizationRepository,
  PasswordHasher,
  UserCredentialsRepository,
  UserRepository,
} from './app/ports/index.js';
export {
  AuthenticateApiKey,
  CreateApiKey,
  CreateUser,
  DeleteApiKey,
  Login,
  RegisterOrganization,
  SetupUserCredentials,
  UpdateUserCredentials,
  useCases,
} from './app/use-cases/index.js';
export {
  ApiKey,
  type ApiKeyProps,
  apiKeySchema,
  Location,
  type LocationProps,
  locationSchema,
  Organization,
  type OrganizationProps,
  organizationSchema,
  User,
  UserCredentials,
  type UserCredentialsProps,
  type UserProps,
  userCredentialsSchema,
  userSchema,
} from './domain/entities/index.js';
export {
  ApiKeyCreated,
  ApiKeyDeleted,
  ApiKeyUpdated,
  DomainEvents,
  LocationCreated,
  LocationDeleted,
  LocationUpdated,
  OrganizationCreated,
  OrganizationDeleted,
  OrganizationUpdated,
  UserCreated,
  UserCredentialsCreated,
  UserCredentialsDeleted,
  UserCredentialsUpdated,
  UserDeleted,
  UserUpdated,
} from './domain/events/domain/catalog.js';
export {
  type Actor,
  actorSchema,
} from './domain/schemas/actor.js';
