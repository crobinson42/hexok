import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { UserEntity } from '../../../../../domain/entities/user.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { OrganizationRepository } from '../../../../ports/repos/organization-repository.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { ApiUseCase } from '../../../context.js';

export const addMemberInput = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type AddMemberInput = z.infer<typeof addMemberInput>;

/**
 * Adds a user to an organization. Does not check that the caller belongs
 * to the organization.
 */
export class AddMember extends ApiUseCase('organization.add-member', {
  input: addMemberInput,
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
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: AddMemberInput,
  ): Promise<UserEntity> {
    const organization = await this.deps.organizations.get(
      input.organizationId,
    );
    if (organization === null) {
      throw DomainError.OrganizationNotFound({ id: input.organizationId });
    }
    const user = await this.deps.users.get(input.userId);
    if (user === null) throw DomainError.UserNotFound({ id: input.userId });
    user.addMembership(organization.props.id);
    await this.deps.users.save(user);
    return user;
  }
}
