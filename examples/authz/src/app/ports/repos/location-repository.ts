import { Port } from 'hexok';
import type { LocationEntity } from '../../../domain/entities/location.js';

export abstract class LocationRepository extends Port('LocationRepository') {
  abstract get(id: string): Promise<LocationEntity | null>;
  abstract save(location: LocationEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract listByIds(
    ids: readonly string[],
  ): Promise<readonly LocationEntity[]>;
}
