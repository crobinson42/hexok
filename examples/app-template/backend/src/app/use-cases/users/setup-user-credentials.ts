import { ApiUseCase, type ExecuteCtx } from 'hexok/app';
import { z } from 'zod';
import {
  UserCredentials,
  userCredentialsSchema,
} from '../../../domain/entities/user-credentials.js';
import { DomainEvents } from '../../../domain/events/domain/catalog.js';
import { UserCredentialsCreated } from '../../../domain/events/domain/user-credentials.js';
import { UserCredentialsRepository } from '../../ports/repos/user-credentials.js';
import { UserRepository } from '../../ports/repos/users.js';

export class SetupUserCredentials extends ApiUseCase {
  static readonly key = 'user.setupCredentials';

  static input = z.object({
    id: z.string(),
    userId: z.string(),
    passwordHash: z.string(),
  });

  static output = userCredentialsSchema;

  static errors = {
    USER_NOT_FOUND: { message: 'User not found' },
    CREDENTIALS_EXIST: { message: 'User credentials already exist' },
  };

  static ports = {
    users: UserRepository,
    userCredentials: UserCredentialsRepository,
  };

  static publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof SetupUserCredentials>) {
    const user = await ports.users.get(input.userId);
    if (!user) throw errors.USER_NOT_FOUND();

    const existingById = await ports.userCredentials.get(input.id);
    if (existingById) throw errors.CREDENTIALS_EXIST();

    const existingByUserId = await ports.userCredentials.getByUserId(
      input.userId,
    );
    if (existingByUserId) throw errors.CREDENTIALS_EXIST();

    const credentials = UserCredentials.create({
      id: input.id,
      userId: user.props.id,
      passwordHash: input.passwordHash,
    });
    await ports.userCredentials.save(credentials);

    publish(new UserCredentialsCreated(credentials.toProps()));

    return credentials.toProps();
  }
}
