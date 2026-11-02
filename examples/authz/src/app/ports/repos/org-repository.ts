import { Port } from 'hexok';
import type { OrgEntity } from '../../../domain/entities/org.js';

export abstract class OrgRepository extends Port('OrgRepository') {
  abstract get(id: string): Promise<OrgEntity | null>;
  abstract save(org: OrgEntity): Promise<void>;
}
