import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { LocationEntity } from '../../../../../domain/entities/location.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import { locationParentSchema } from '../../../../../domain/schemas/location.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { LocationRepository } from '../../../../ports/repos/location-repository.js';
import type { OrgRepository } from '../../../../ports/repos/org-repository.js';
import type { RegionRepository } from '../../../../ports/repos/region-repository.js';
import { ApiUseCase } from '../../../context.js';
import { writeTuple } from '../../../write-tuple.js';

export const createLocationInput = z.object({
  id: idSchema,
  name: textSchema,
  parent: locationParentSchema,
});

export type CreateLocationInput = z.infer<typeof createLocationInput>;

/** The parent must exist, then the actor must pass that parent's edit action. */
export class CreateLocation extends ApiUseCase('location.create', {
  input: createLocationInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      orgs: OrgRepository;
      regions: RegionRepository;
      locations: LocationRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: CreateLocationInput,
  ): Promise<LocationEntity> {
    await this.#requireParentEdit(ctx, input.parent);
    if ((await this.deps.locations.get(input.id)) !== null) {
      throw DomainError.AlreadyExists({ type: 'location', id: input.id });
    }
    const location = LocationEntity.create({
      id: input.id,
      name: input.name,
      parent: input.parent,
    });
    await this.deps.locations.save(location);
    await writeTuple(
      this.deps.authz,
      {
        object: `location:${location.props.id}`,
        relation: 'parent',
        subject: `${location.props.parent.type}:${location.props.parent.id}`,
      },
      () => this.deps.locations.delete(location.props.id),
    );
    return location;
  }

  async #requireParentEdit(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    parent: CreateLocationInput['parent'],
  ): Promise<void> {
    if (parent.type === 'region') {
      if ((await this.deps.regions.get(parent.id)) === null) {
        throw DomainError.NotFound({ type: 'region', id: parent.id });
      }
      const allowed = await this.deps.authz.check({
        actor: ctx.actor,
        action: 'region:edit',
        resource: { type: 'region', id: parent.id },
      });
      if (!allowed) throw DomainError.Forbidden();
      return;
    }
    if ((await this.deps.orgs.get(parent.id)) === null) {
      throw DomainError.NotFound({ type: 'org', id: parent.id });
    }
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'org:edit',
      resource: { type: 'org', id: parent.id },
    });
    if (!allowed) throw DomainError.Forbidden();
  }
}
