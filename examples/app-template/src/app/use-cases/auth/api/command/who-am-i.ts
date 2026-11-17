import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { UserEntity } from '../../../../../domain/entities/user.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { ApiUseCase } from '../../../context.js';

export const whoAmIInput = z.object({});

/** The user the session names. */
export class WhoAmI extends ApiUseCase('auth.whoami', { input: whoAmIInput }) {
  constructor(
    private readonly deps: {
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: z.infer<typeof whoAmIInput>,
  ): Promise<UserEntity> {
    const user = await this.deps.users.get(ctx.caller.userId);
    if (user === null) {
      throw DomainError.UserNotFound({ id: ctx.caller.userId });
    }
    return user;
  }
}
