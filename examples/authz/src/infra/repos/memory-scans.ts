import { Adapter } from 'hexok';
import { ScanRepository } from '../../app/ports/repos/scan-repository.js';
import { ScanEntity } from '../../domain/entities/scan.js';
import { rowTable } from './row-table.js';

export class MemoryScans extends Adapter(ScanRepository) {
  readonly #rows = rowTable<ReturnType<ScanEntity['toProps']>, ScanEntity>(
    (props) => ScanEntity.restore(props),
  );

  override async get(id: string): Promise<ScanEntity | null> {
    return this.#rows.get(id);
  }

  override async save(scan: ScanEntity): Promise<void> {
    this.#rows.save(scan);
  }

  override async delete(id: string): Promise<void> {
    this.#rows.delete(id);
  }

  override async listByIds(
    ids: readonly string[],
  ): Promise<readonly ScanEntity[]> {
    return this.#rows.listByIds(ids);
  }
}
