import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { LocationEntity } from '../../../../../domain/entities/location.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { LocationRepository } from '../../../../ports/repos/location-repository.js';
import { ApiUseCase } from '../../../context.js';

export const getLocationInput = z.object({
  id: idSchema,
});

export type GetLocationInput = z.infer<typeof getLocationInput>;

/** `location:view` runs before the record is loaded. */
export class GetLocation extends ApiUseCase('location.get', {
  input: getLocationInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      locations: LocationRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: GetLocationInput,
  ): Promise<LocationEntity> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'location:view',
      resource: { type: 'location', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    const location = await this.deps.locations.get(input.id);
    if (location === null) {
      throw DomainError.NotFound({ type: 'location', id: input.id });
    }
    return location;
  }
}
