import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { ScanEntity } from '../../../../../domain/entities/scan.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { ScanRepository } from '../../../../ports/repos/scan-repository.js';
import { ApiUseCase } from '../../../context.js';

export const listScansInput = z.object({});

export type ListScansInput = z.infer<typeof listScansInput>;

/** Ids from `scan:view`, then those scan records. */
export class ListScans extends ApiUseCase('scan.list', {
  input: listScansInput,
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
    _input: ListScansInput,
  ): Promise<readonly ScanEntity[]> {
    const ids = await this.deps.authz.list({
      actor: ctx.actor,
      action: 'scan:view',
      type: 'scan',
    });
    return this.deps.scans.listByIds(ids);
  }
}
