import { UseCase } from 'hexok';
import { UserEntity } from '../entities/user.js';
import { DomainError } from '../errors/domain.js';
import type { DomainEventPublisher } from '../ports/domain-event-publisher.js';
import type { UserRepository } from '../ports/user-repository.js';

export class CreateUser extends UseCase('user.create') {
  constructor(
    readonly deps: {
      domainEventPublisher: DomainEventPublisher;
      users: UserRepository;
    },
  ) {
    super();
  }

  async execute(input: {
    id: string;
    name: string;
    email: string;
  }): Promise<UserEntity> {
    const existing = await this.deps.users.get(input.id);
    if (existing) throw DomainError.UserExists({ id: input.id });
    const user = UserEntity.create(input);
    await this.deps.users.save(user);
    await this.deps.domainEventPublisher.publish({
      key: 'userCreated',
      payload: {
        id: user.props.id,
        name: user.props.name,
        email: user.props.email,
      },
    });
    return user;
  }
}
