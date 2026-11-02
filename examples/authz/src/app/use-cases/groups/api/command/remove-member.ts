import type { Authz, Tuple } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { GroupRepository } from '../../../../ports/repos/group-repository.js';
import { ApiUseCase } from '../../../context.js';
import { memberSubject } from '../../member-subject.js';

export const removeMemberInput = z.object({
  id: idSchema,
  subject: textSchema,
});

export type RemoveMemberInput = z.infer<typeof removeMemberInput>;

/** `group:edit`, then delete the `member` tuple. */
export class RemoveMember extends ApiUseCase('group.remove-member', {
  input: removeMemberInput,
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
    input: RemoveMemberInput,
  ): Promise<Tuple> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'group:edit',
      resource: { type: 'group', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    if ((await this.deps.groups.get(input.id)) === null) {
      throw DomainError.NotFound({ type: 'group', id: input.id });
    }
    await memberSubject(this.deps.groups, input.subject);
    const tuple: Tuple = {
      object: `group:${input.id}`,
      relation: 'member',
      subject: input.subject,
    };
    await this.deps.authz.delete(tuple);
    return tuple;
  }
}
