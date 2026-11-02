import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { LocationEntity } from '../../../../../domain/entities/location.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { LocationRepository } from '../../../../ports/repos/location-repository.js';
import { ApiUseCase } from '../../../context.js';

export const listLocationsInput = z.object({});

export type ListLocationsInput = z.infer<typeof listLocationsInput>;

/** Ids from `location:view`, then those location records. */
export class ListLocations extends ApiUseCase('location.list', {
  input: listLocationsInput,
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
    _input: ListLocationsInput,
  ): Promise<readonly LocationEntity[]> {
    const ids = await this.deps.authz.list({
      actor: ctx.actor,
      action: 'location:view',
      type: 'location',
    });
    return this.deps.locations.listByIds(ids);
  }
}
