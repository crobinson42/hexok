import { ApiUseCase, type ExecuteCtx } from 'plinth/app';
import { z } from 'zod';
import { User, userSchema } from '../../../domain/entities/user.js';
import { DomainEvents } from '../../../domain/events/index.js';
import { UserCreated } from '../../../domain/events/user.js';
import { EmailService } from '../../ports/services/email.js';
import { UserRepository } from '../../ports/repos/users-repo.js';

export class CreateUser extends ApiUseCase {
  static readonly key = 'user.create';
  static readonly internal = true;

  static input = z.object({
    id: z.string(),
    organizationIds: z.array(z.string()).min(1),
    name: z.string(),
    email: z.string(),
  });

  static output = userSchema;

  static errors = {
    USER_EXISTS: { message: 'User already exists' },
  };

  static ports = {
    users: UserRepository,
    email: Email,
  };

  static publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CreateUser>) {
    const existingUser = await ports.users.get(input.id);
    if (existingUser) throw errors.USER_EXISTS();

    const user = User.create({
      id: input.id,
      organizationIds: input.organizationIds,
      name: input.name,
      email: input.email,
    });
    await ports.users.save(user);

    await ports.email.send({
      to: user.props.email,
      subject: 'Set up your account',
      body: `Set up credentials for user ${user.props.id}.`,
    });

    publish(
      new UserCreated({
        ...user.toProps(),
        organizationIds: [...user.props.organizationIds],
      }),
    );

    return user.toProps();
  }
}
