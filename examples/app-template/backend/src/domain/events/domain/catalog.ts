import { EventCatalog } from 'hexok/domain';
import { ApiKeyCreated, ApiKeyDeleted, ApiKeyUpdated } from './api-key.js';
import {
  LocationCreated,
  LocationDeleted,
  LocationUpdated,
} from './location.js';
import {
  OrganizationCreated,
  OrganizationDeleted,
  OrganizationUpdated,
} from './organization.js';
import { UserCreated, UserDeleted, UserUpdated } from './user.js';
import {
  UserCredentialsCreated,
  UserCredentialsDeleted,
  UserCredentialsUpdated,
} from './user-credentials.js';

export { ApiKeyCreated, ApiKeyDeleted, ApiKeyUpdated } from './api-key.js';
export {
  LocationCreated,
  LocationDeleted,
  LocationUpdated,
} from './location.js';
export {
  OrganizationCreated,
  OrganizationDeleted,
  OrganizationUpdated,
} from './organization.js';
export { UserCreated, UserDeleted, UserUpdated } from './user.js';
export {
  UserCredentialsCreated,
  UserCredentialsDeleted,
  UserCredentialsUpdated,
} from './user-credentials.js';

export const DomainEvents = new EventCatalog('domain', { kind: 'queue' })
  .event(OrganizationCreated)
  .event(OrganizationUpdated)
  .event(OrganizationDeleted)
  .event(UserCreated)
  .event(UserUpdated)
  .event(UserDeleted)
  .event(UserCredentialsCreated)
  .event(UserCredentialsUpdated)
  .event(UserCredentialsDeleted)
  .event(ApiKeyCreated)
  .event(ApiKeyUpdated)
  .event(ApiKeyDeleted)
  .event(LocationCreated)
  .event(LocationUpdated)
  .event(LocationDeleted);
