import { Adapter } from 'hexok';
import { OrgRepository } from '../../app/ports/repos/org-repository.js';
import { OrgEntity } from '../../domain/entities/org.js';
import { rowTable } from './row-table.js';

export class MemoryOrgs extends Adapter(OrgRepository) {
  readonly #rows = rowTable<ReturnType<OrgEntity['toProps']>, OrgEntity>(
    (props) => OrgEntity.restore(props),
  );

  override async get(id: string): Promise<OrgEntity | null> {
    return this.#rows.get(id);
  }

  override async save(org: OrgEntity): Promise<void> {
    this.#rows.save(org);
  }
}
