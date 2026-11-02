import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { RegionEntity } from '../../../../../domain/entities/region.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { OrgRepository } from '../../../../ports/repos/org-repository.js';
import type { RegionRepository } from '../../../../ports/repos/region-repository.js';
import { ApiUseCase } from '../../../context.js';
import { writeTuple } from '../../../write-tuple.js';

export const createRegionInput = z.object({
  id: idSchema,
  name: textSchema,
  orgId: idSchema,
});

export type CreateRegionInput = z.infer<typeof createRegionInput>;

/** The organization must exist, then the actor must pass `org:edit`. */
export class CreateRegion extends ApiUseCase('region.create', {
  input: createRegionInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      orgs: OrgRepository;
      regions: RegionRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: CreateRegionInput,
  ): Promise<RegionEntity> {
    if ((await this.deps.orgs.get(input.orgId)) === null) {
      throw DomainError.NotFound({ type: 'org', id: input.orgId });
    }
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'org:edit',
      resource: { type: 'org', id: input.orgId },
    });
    if (!allowed) throw DomainError.Forbidden();
    if ((await this.deps.regions.get(input.id)) !== null) {
      throw DomainError.AlreadyExists({ type: 'region', id: input.id });
    }
    const region = RegionEntity.create({
      id: input.id,
      name: input.name,
      orgId: input.orgId,
    });
    await this.deps.regions.save(region);
    await writeTuple(
      this.deps.authz,
      {
        object: `region:${region.props.id}`,
        relation: 'parent',
        subject: `org:${region.props.orgId}`,
      },
      () => this.deps.regions.delete(region.props.id),
    );
    return region;
  }
}
