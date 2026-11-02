import { Adapter } from 'hexok';
import { LocationRepository } from '../../app/ports/repos/location-repository.js';
import { LocationEntity } from '../../domain/entities/location.js';
import { rowTable } from './row-table.js';

export class MemoryLocations extends Adapter(LocationRepository) {
  readonly #rows = rowTable<
    ReturnType<LocationEntity['toProps']>,
    LocationEntity
  >((props) => LocationEntity.restore(props));

  override async get(id: string): Promise<LocationEntity | null> {
    return this.#rows.get(id);
  }

  override async save(location: LocationEntity): Promise<void> {
    this.#rows.save(location);
  }

  override async delete(id: string): Promise<void> {
    this.#rows.delete(id);
  }

  override async listByIds(
    ids: readonly string[],
  ): Promise<readonly LocationEntity[]> {
    return this.#rows.listByIds(ids);
  }
}
