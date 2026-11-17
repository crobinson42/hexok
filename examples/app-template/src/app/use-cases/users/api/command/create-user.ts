import type { UseCase } from 'hexok';
import { z } from 'zod';
import { UserEntity } from '../../../../../domain/entities/user.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { PublicApiUseCase } from '../../../context.js';

export const createUserInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export type CreateUserInput = z.infer<typeof createUserInput>;

/** Creates an identity. This does not set a password. */
export class CreateUser extends PublicApiUseCase('user.create', {
  input: createUserInput,
}) {
  constructor(
    private readonly deps: {
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof PublicApiUseCase>,
    input: CreateUserInput,
  ): Promise<UserEntity> {
    const existing = await this.deps.users.get(input.id);
    if (existing !== null)
      throw DomainError.UserAlreadyExists({ id: input.id });
    const user = UserEntity.create({
      id: input.id,
      name: input.name,
      organizationIds: [],
    });
    await this.deps.users.save(user);
    return user;
  }
}
