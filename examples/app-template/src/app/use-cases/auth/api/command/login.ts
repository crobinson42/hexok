import type { UseCase } from 'hexok';
import { z } from 'zod';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { Credentials } from '../../../../ports/auth/credentials.js';
import type { UserRepository } from '../../../../ports/repos/user-repository.js';
import { type Caller, PublicApiUseCase } from '../../../context.js';

export const loginInput = z.object({
  userId: z.string().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginInput>;

/**
 * Checks the password and loads the user. The gateway turns that caller
 * into a JWT. This use case does not see it. A missing user is the same
 * refusal as a wrong password.
 */
export class Login extends PublicApiUseCase('auth.login', {
  input: loginInput,
}) {
  constructor(
    private readonly deps: {
      credentials: Credentials;
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof PublicApiUseCase>,
    input: LoginInput,
  ): Promise<Caller> {
    const accepted = await this.deps.credentials.check(input);
    if (!accepted) throw DomainError.InvalidCredentials();
    const user = await this.deps.users.get(input.userId);
    if (user === null) throw DomainError.InvalidCredentials();
    return { userId: user.props.id };
  }
}
