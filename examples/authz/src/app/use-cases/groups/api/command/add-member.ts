import type { Authz, Tuple } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { GroupRepository } from '../../../../ports/repos/group-repository.js';
import { ApiUseCase } from '../../../context.js';
import { memberSubject } from '../../member-subject.js';

export const addMemberInput = z.object({
  id: idSchema,
  subject: textSchema,
});

export type AddMemberInput = z.infer<typeof addMemberInput>;

/** `group:edit`, then a `member` tuple. The group record stays `{ id, name }`. */
export class AddMember extends ApiUseCase('group.add-member', {
  input: addMemberInput,
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
    input: AddMemberInput,
  ): Promise<Tuple> {
    await requireGroupEdit(this.deps, ctx, input.id);
    await memberSubject(this.deps.groups, input.subject);
    const tuple: Tuple = {
      object: `group:${input.id}`,
      relation: 'member',
      subject: input.subject,
    };
    await this.deps.authz.write(tuple);
    return tuple;
  }
}

async function requireGroupEdit(
  deps: { authz: Authz<typeof catalog>; groups: GroupRepository },
  ctx: UseCase.Ctx<typeof ApiUseCase>,
  id: string,
): Promise<void> {
  const allowed = await deps.authz.check({
    actor: ctx.actor,
    action: 'group:edit',
    resource: { type: 'group', id },
  });
  if (!allowed) throw DomainError.Forbidden();
  if ((await deps.groups.get(id)) === null) {
    throw DomainError.NotFound({ type: 'group', id });
  }
}
