import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { GroupEntity } from '../../../../../domain/entities/group.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import { actorRef } from '../../../../authz/actor.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { GroupRepository } from '../../../../ports/repos/group-repository.js';
import { ApiUseCase } from '../../../context.js';
import { writeTuple } from '../../../write-tuple.js';

export const createGroupInput = z.object({
  id: idSchema,
  name: textSchema,
});

export type CreateGroupInput = z.infer<typeof createGroupInput>;

/** Any actor can create a group. The actor becomes its editor. */
export class CreateGroup extends ApiUseCase('group.create', {
  input: createGroupInput,
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
    input: CreateGroupInput,
  ): Promise<GroupEntity> {
    if ((await this.deps.groups.get(input.id)) !== null) {
      throw DomainError.AlreadyExists({ type: 'group', id: input.id });
    }
    const group = GroupEntity.create({ id: input.id, name: input.name });
    await this.deps.groups.save(group);
    await writeTuple(
      this.deps.authz,
      {
        object: `group:${group.props.id}`,
        relation: 'editor',
        subject: actorRef(ctx.actor),
      },
      () => this.deps.groups.delete(group.props.id),
    );
    return group;
  }
}
