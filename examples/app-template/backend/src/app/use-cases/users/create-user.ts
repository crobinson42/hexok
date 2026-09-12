import { type ExecuteCtx, InternalUseCase } from 'hexok/app';
import { z } from 'zod';
import { User, userSchema } from '../../../domain/entities/user.js';
import { DomainEvents } from '../../../domain/events/domain/catalog.js';
import { UserCreated } from '../../../domain/events/domain/user.js';
import {
  ClientEvents,
  UserCreated as UserCreatedClient,
} from '../../events/client/catalog.js';
import { UserRepository } from '../../ports/repos/users.js';
import { EmailService } from '../../ports/services/email.js';

export class CreateUser extends InternalUseCase {
  static readonly key = 'user.create';

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
    email: EmailService,
  };

  static publishes = [DomainEvents, ClientEvents] as const;

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

    const payload = {
      ...user.toProps(),
      organizationIds: [...user.props.organizationIds],
    };
    publish(new UserCreated(payload));
    publish(
      new UserCreatedClient(payload, {
        kind: 'organization',
        organizationIds: payload.organizationIds,
      }),
    );

    return user.toProps();
  }
}
