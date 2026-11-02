import { Port } from 'hexok';
import type { GroupEntity } from '../../../domain/entities/group.js';

export abstract class GroupRepository extends Port('GroupRepository') {
  abstract get(id: string): Promise<GroupEntity | null>;
  abstract save(group: GroupEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract listByIds(ids: readonly string[]): Promise<readonly GroupEntity[]>;
}
