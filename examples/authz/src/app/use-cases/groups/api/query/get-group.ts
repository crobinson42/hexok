import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { GroupEntity } from '../../../../../domain/entities/group.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { GroupRepository } from '../../../../ports/repos/group-repository.js';
import { ApiUseCase } from '../../../context.js';

export const getGroupInput = z.object({
  id: idSchema,
});

export type GetGroupInput = z.infer<typeof getGroupInput>;

/** The group record is `{ id, name }`. Members are tuples. */
export class GetGroup extends ApiUseCase('group.get', {
  input: getGroupInput,
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
    input: GetGroupInput,
  ): Promise<GroupEntity> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'group:view',
      resource: { type: 'group', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    const group = await this.deps.groups.get(input.id);
    if (group === null) {
      throw DomainError.NotFound({ type: 'group', id: input.id });
    }
    return group;
  }
}
