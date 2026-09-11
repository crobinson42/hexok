import { ApiUseCase, type ExecuteCtx } from 'kerf/app';
import { z } from 'zod';
import { userCredentialsSchema } from '../../../domain/entities/user-credentials.js';
import { DomainEvents } from '../../../domain/events/index.js';
import { UserCredentialsUpdated } from '../../../domain/events/user-credentials.js';
import { requireUser } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { UserCredentialsRepository } from '../../ports/repos/user-credentials-repo.js';

export class UpdateUserCredentials extends ApiUseCase {
  static readonly key = 'user.updateCredentials';

  static input = z.object({
    userId: z.string(),
    passwordHash: z.string(),
  });

  static output = userCredentialsSchema;

  static errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
    FORBIDDEN: { message: 'Forbidden' },
    CREDENTIALS_NOT_FOUND: { message: 'User credentials not found' },
  };

  static ports = {
    userCredentials: UserCredentialsRepository,
  };

  static publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
    ctx,
  }: ExecuteCtx<typeof UpdateUserCredentials, AppContext>) {
    requireUser(ctx, input.userId, errors);

    const credentials = await ports.userCredentials.getByUserId(input.userId);
    if (!credentials) throw errors.CREDENTIALS_NOT_FOUND();

    credentials.updatePasswordHash(input.passwordHash);
    await ports.userCredentials.save(credentials);

    publish(new UserCredentialsUpdated(credentials.toProps()));

    return credentials.toProps();
  }
}
