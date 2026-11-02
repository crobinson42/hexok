import { Adapter } from 'hexok';
import { GroupRepository } from '../../app/ports/repos/group-repository.js';
import { GroupEntity } from '../../domain/entities/group.js';
import { rowTable } from './row-table.js';

export class MemoryGroups extends Adapter(GroupRepository) {
  readonly #rows = rowTable<ReturnType<GroupEntity['toProps']>, GroupEntity>(
    (props) => GroupEntity.restore(props),
  );

  override async get(id: string): Promise<GroupEntity | null> {
    return this.#rows.get(id);
  }

  override async save(group: GroupEntity): Promise<void> {
    this.#rows.save(group);
  }

  override async delete(id: string): Promise<void> {
    this.#rows.delete(id);
  }

  override async listByIds(
    ids: readonly string[],
  ): Promise<readonly GroupEntity[]> {
    return this.#rows.listByIds(ids);
  }
}
