import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { UserEntity } from '../../../../../domain/entities/user.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { ApiUseCase } from '../../../context.js';

export const getUserInput = z.object({
  id: z.string().min(1),
});

export type GetUserInput = z.infer<typeof getUserInput>;

/** Loads a user by id. Does not check membership. */
export class GetUser extends ApiUseCase('user.get', { input: getUserInput }) {
  constructor(
    private readonly deps: {
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: GetUserInput,
  ): Promise<UserEntity> {
    const user = await this.deps.users.get(input.id);
    if (user === null) throw DomainError.UserNotFound({ id: input.id });
    return user;
  }
}
