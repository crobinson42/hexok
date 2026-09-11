import { Port } from 'plinth/domain';
import type { Organization } from '../../../domain/entities/index.js';

export interface OrganizationRepository {
  get(id: string): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}
export const OrganizationRepository = Port.token<OrganizationRepository>(
  'OrganizationRepository',
);
