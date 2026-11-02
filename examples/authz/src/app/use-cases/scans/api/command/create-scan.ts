import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { ScanEntity } from '../../../../../domain/entities/scan.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { LocationRepository } from '../../../../ports/repos/location-repository.js';
import type { ScanRepository } from '../../../../ports/repos/scan-repository.js';
import { ApiUseCase } from '../../../context.js';
import { writeTuple } from '../../../write-tuple.js';

export const createScanInput = z.object({
  id: idSchema,
  title: textSchema,
  locationId: idSchema,
});

export type CreateScanInput = z.infer<typeof createScanInput>;

/**
 * The location must exist, then the actor must pass `location:edit`.
 * The location id on the scan is the product fact. The parent tuple is the
 * authorization fact.
 */
export class CreateScan extends ApiUseCase('scan.create', {
  input: createScanInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      locations: LocationRepository;
      scans: ScanRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: CreateScanInput,
  ): Promise<ScanEntity> {
    const location = await this.deps.locations.get(input.locationId);
    if (location === null) {
      throw DomainError.NotFound({ type: 'location', id: input.locationId });
    }
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'location:edit',
      resource: { type: 'location', id: input.locationId },
    });
    if (!allowed) throw DomainError.Forbidden();
    if ((await this.deps.scans.get(input.id)) !== null) {
      throw DomainError.AlreadyExists({ type: 'scan', id: input.id });
    }
    const scan = ScanEntity.create({
      id: input.id,
      title: input.title,
      locationId: input.locationId,
    });
    await this.deps.scans.save(scan);
    await writeTuple(
      this.deps.authz,
      {
        object: `scan:${scan.props.id}`,
        relation: 'parent',
        subject: `location:${scan.props.locationId}`,
      },
      () => this.deps.scans.delete(scan.props.id),
    );
    return scan;
  }
}
