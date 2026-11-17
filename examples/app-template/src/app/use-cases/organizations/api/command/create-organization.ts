import { randomUUID } from 'node:crypto';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { OrganizationEntity } from '../../../../../domain/entities/organization.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { OrganizationRepository } from '../../../../ports/repos/organization-repository.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { ApiUseCase } from '../../../context.js';

export const createOrganizationInput = z.object({
  name: z.string().min(1),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInput>;

/** Creates an organization and adds the caller as a member. */
export class CreateOrganization extends ApiUseCase('organization.create', {
  input: createOrganizationInput,
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
    input: CreateOrganizationInput,
  ): Promise<OrganizationEntity> {
    const user = await this.deps.users.get(ctx.caller.userId);
    if (user === null) {
      throw DomainError.UserNotFound({ id: ctx.caller.userId });
    }
    const organization = OrganizationEntity.create({
      id: randomUUID(),
      name: input.name,
    });
    user.addMembership(organization.props.id);
    await this.deps.organizations.save(organization);
    await this.deps.users.save(user);
    return organization;
  }
}
