import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { ScanEntity } from '../../../../../domain/entities/scan.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { ScanRepository } from '../../../../ports/repos/scan-repository.js';
import { ApiUseCase } from '../../../context.js';

export const getScanInput = z.object({
  id: idSchema,
});

export type GetScanInput = z.infer<typeof getScanInput>;

/**
 * `scan:view` runs before the record is loaded.
 * A failed check is forbidden, including an id the repository has never stored.
 */
export class GetScan extends ApiUseCase('scan.get', {
  input: getScanInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      scans: ScanRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: GetScanInput,
  ): Promise<ScanEntity> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'scan:view',
      resource: { type: 'scan', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    const scan = await this.deps.scans.get(input.id);
    if (scan === null) {
      throw DomainError.NotFound({ type: 'scan', id: input.id });
    }
    return scan;
  }
}
