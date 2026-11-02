import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { ScanEntity } from '../../../../../domain/entities/scan.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { ScanRepository } from '../../../../ports/repos/scan-repository.js';
import { ApiUseCase } from '../../../context.js';

export const updateScanInput = z.object({
  id: idSchema,
  title: textSchema,
});

export type UpdateScanInput = z.infer<typeof updateScanInput>;

/** `scan:edit` includes an editor of an ancestor. */
export class UpdateScan extends ApiUseCase('scan.update', {
  input: updateScanInput,
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
    input: UpdateScanInput,
  ): Promise<ScanEntity> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'scan:edit',
      resource: { type: 'scan', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    const scan = await this.deps.scans.get(input.id);
    if (scan === null) {
      throw DomainError.NotFound({ type: 'scan', id: input.id });
    }
    scan.rename(input.title);
    await this.deps.scans.save(scan);
    return scan;
  }
}
