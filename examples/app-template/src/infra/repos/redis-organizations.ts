import { Adapter } from 'hexok';
import { OrganizationRepository } from '../../app/ports/repos/organization-repository.js';
import { OrganizationEntity } from '../../domain/entities/organization.js';
import type { RedisClient } from '../clients/redis-client.js';

export class RedisOrganizations extends Adapter(OrganizationRepository) {
  constructor(private readonly deps: { redis: RedisClient }) {
    super();
  }

  override async get(id: string): Promise<OrganizationEntity | null> {
    const raw = await this.deps.redis.get(`organization:${id}`);
    if (raw === null) return null;
    return OrganizationEntity.restore(
      JSON.parse(raw) as ConstructorParameters<typeof OrganizationEntity>[0],
    );
  }

  override async getMany(
    ids: readonly string[],
  ): Promise<readonly OrganizationEntity[]> {
    const found: OrganizationEntity[] = [];
    for (const id of ids) {
      const organization = await this.get(id);
      if (organization !== null) found.push(organization);
    }
    return found;
  }

  override async save(organization: OrganizationEntity): Promise<void> {
    const props = organization.toProps();
    await this.deps.redis.set(
      `organization:${props.id}`,
      JSON.stringify(props),
    );
    organization.commit();
  }
}
