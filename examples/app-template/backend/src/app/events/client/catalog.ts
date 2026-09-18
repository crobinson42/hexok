import { EventCatalog } from 'hexok/domain';
import type { ClientEventCtx } from '../../context.js';
import { ApiKeyCreated, ApiKeyDeleted } from './api-key.js';
import { OrganizationCreated } from './organization.js';
import { UserCreated } from './user.js';

export { ApiKeyCreated, ApiKeyDeleted } from './api-key.js';
export { OrganizationCreated } from './organization.js';
export { UserCreated } from './user.js';

export const ClientEvents = new EventCatalog('client', { kind: 'bus' })
  .ctx<ClientEventCtx>()
  .event(OrganizationCreated)
  .event(UserCreated)
  .event(ApiKeyCreated)
  .event(ApiKeyDeleted);