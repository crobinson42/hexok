import { type ExecuteCtx, ExternalUseCase } from 'hexok/app';
import { z } from 'zod';
import { userCredentialsSchema } from '../../../domain/entities/user-credentials.js';
import { DomainEvents } from '../../../domain/events/domain/catalog.js';
import { UserCredentialsUpdated } from '../../../domain/events/domain/user-credentials.js';
import { requireUser } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { AuthErrors } from '../../errors.js';
import { UserCredentialsRepository } from '../../ports/repos/user-credentials.js';

export class UpdateUserCredentials extends ExternalUseCase {
  static readonly key = 'user.updateCredentials';

  static input = z.object({
    userId: z.string(),
    passwordHash: z.string(),
  });

  static output = userCredentialsSchema;

  static errors = {
    ...AuthErrors,
    CREDENTIALS_NOT_FOUND: { message: 'User credentials not found' },
  } as const;

  static ports = {
    userCredentials: UserCredentialsRepository,
  };

  static readonly guards = [] as const;

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
