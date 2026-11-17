import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { OrganizationEntity } from '../../../../../domain/entities/organization.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { OrganizationRepository } from '../../../../ports/repos/organization-repository.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { ApiUseCase } from '../../../context.js';

export const listMineInput = z.object({});

/** The organizations the caller belongs to. */
export class ListMine extends ApiUseCase('organization.list-mine', {
  input: listMineInput,
}) {
  constructor(
    private readonly deps: {
      organizations: OrganizationRepository;
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: z.infer<typeof listMineInput>,
  ): Promise<readonly OrganizationEntity[]> {
    const user = await this.deps.users.get(ctx.caller.userId);
    if (user === null) {
      throw DomainError.UserNotFound({ id: ctx.caller.userId });
    }
    return this.deps.organizations.getMany(user.props.organizationIds);
  }
}
