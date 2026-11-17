import { Entity } from 'hexok';
import { OrganizationSchema } from '../schemas/organization.js';

export class OrganizationEntity extends Entity(
  'Organization',
  OrganizationSchema,
) {}
