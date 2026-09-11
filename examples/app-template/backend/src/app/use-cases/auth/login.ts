import { ApiUseCase, type ExecuteCtx } from 'plinth/app';
import { z } from 'zod';
import { actorSchema } from '../../../domain/schemas/actor.js';
import { PasswordHasher } from '../../ports/utilities/password-hasher.js';
import { AuthTokenService } from '../../ports/services/authTokenService.js';
import { UserCredentialsRepository } from '../../ports/repos/user-credentials-repo.js';
import { UserRepository } from '../../ports/repos/users-repo.js';

export class Login extends ApiUseCase {
  static readonly key = 'auth.login';

  static input = z.object({
    email: z.string(),
    password: z.string(),
  });

  static output = z.object({
    actor: actorSchema,
    token: z.string(),
  });

  static errors = {
    INVALID_CREDENTIALS: { message: 'Invalid credentials' },
  };

  static ports = {
    users: UserRepository,
    userCredentials: UserCredentialsRepository,
    passwordHasher: PasswordHasher,
    token: Token,
  };

  async execute({ input, ports, errors }: ExecuteCtx<typeof Login>) {
    const user = await ports.users.getByEmail(input.email);
    if (!user) throw errors.INVALID_CREDENTIALS();

    const credentials = await ports.userCredentials.getByUserId(user.props.id);
    if (!credentials) throw errors.INVALID_CREDENTIALS();

    const valid = await ports.passwordHasher.verify(
      input.password,
      credentials.props.passwordHash,
    );
    if (!valid) throw errors.INVALID_CREDENTIALS();

    const actor = {
      type: 'user' as const,
      userId: user.props.id,
      organizationIds: [...user.props.organizationIds],
    };

    return {
      actor,
      token: await ports.token.issue(actor),
    };
  }
}
