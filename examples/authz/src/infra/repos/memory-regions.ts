import { Adapter } from 'hexok';
import { RegionRepository } from '../../app/ports/repos/region-repository.js';
import { RegionEntity } from '../../domain/entities/region.js';
import { rowTable } from './row-table.js';

export class MemoryRegions extends Adapter(RegionRepository) {
  readonly #rows = rowTable<ReturnType<RegionEntity['toProps']>, RegionEntity>(
    (props) => RegionEntity.restore(props),
  );

  override async get(id: string): Promise<RegionEntity | null> {
    return this.#rows.get(id);
  }

  override async save(region: RegionEntity): Promise<void> {
    this.#rows.save(region);
  }

  override async delete(id: string): Promise<void> {
    this.#rows.delete(id);
  }
}
