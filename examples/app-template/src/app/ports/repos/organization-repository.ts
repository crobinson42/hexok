import { Port } from 'hexok';
import type { OrganizationEntity } from '../../../domain/entities/organization.js';

export abstract class OrganizationRepository extends Port(
  'OrganizationRepository',
) {
  abstract get(id: string): Promise<OrganizationEntity | null>;
  abstract getMany(
    ids: readonly string[],
  ): Promise<readonly OrganizationEntity[]>;
  abstract save(organization: OrganizationEntity): Promise<void>;
}
