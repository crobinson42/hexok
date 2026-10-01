import type { UseCase } from 'hexok';
import { z } from 'zod';
import { UserEntity } from '../../../entities/user.js';
import { DomainError } from '../../../errors/domain.js';
import { UserCreatedEvent } from '../../../events/user-created.js';
import type { DomainEventPublisher } from '../../../ports/domain-event-publisher.js';
import type { UserRepository } from '../../../ports/user-repository.js';
import { ActorApiUseCase } from '../../factory.js';

export class CreateUser extends ActorApiUseCase('user.create', {
  allowedActors: ['user'],
  input: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    email: z.string().email(),
  }),
}) {
  constructor(
    readonly deps: {
      domainEventPublisher: DomainEventPublisher;
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ActorApiUseCase>,
    input: {
      id: string;
      name: string;
      email: string;
    },
  ): Promise<UserEntity> {
    const existing = await this.deps.users.get(input.id);

    if (existing) throw DomainError.UserExists({ id: input.id });

    const user = UserEntity.create(input);

    await this.deps.users.save(user);

    await this.deps.domainEventPublisher.publish(
      new UserCreatedEvent({
        id: user.props.id,
        name: user.props.name,
        email: user.props.email,
      }),
    );

    return user;
  }
}
