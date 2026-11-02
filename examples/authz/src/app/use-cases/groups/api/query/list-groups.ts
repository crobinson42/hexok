import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { GroupEntity } from '../../../../../domain/entities/group.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { GroupRepository } from '../../../../ports/repos/group-repository.js';
import { ApiUseCase } from '../../../context.js';

export const listGroupsInput = z.object({});

export type ListGroupsInput = z.infer<typeof listGroupsInput>;

/** Ids from `group:view`. A member can open the group. An org member cannot. */
export class ListGroups extends ApiUseCase('group.list', {
  input: listGroupsInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      groups: GroupRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: ListGroupsInput,
  ): Promise<readonly GroupEntity[]> {
    const ids = await this.deps.authz.list({
      actor: ctx.actor,
      action: 'group:view',
      type: 'group',
    });
    return this.deps.groups.listByIds(ids);
  }
}
