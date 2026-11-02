import { Port } from 'hexok';
import type { RegionEntity } from '../../../domain/entities/region.js';

export abstract class RegionRepository extends Port('RegionRepository') {
  abstract get(id: string): Promise<RegionEntity | null>;
  abstract save(region: RegionEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
}
