import { Port } from 'hexok';
import type { ScanEntity } from '../../../domain/entities/scan.js';

export abstract class ScanRepository extends Port('ScanRepository') {
  abstract get(id: string): Promise<ScanEntity | null>;
  abstract save(scan: ScanEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract listByIds(ids: readonly string[]): Promise<readonly ScanEntity[]>;
}
