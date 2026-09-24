import { Adapter, EventCatalog, Port, UseCase } from 'hexok';
import { DomainError } from './errors.js';
import { UserCreatedEvent, UserEntity, type UserSchema } from './user.js';

export abstract class UserRepository extends Port('UserRepository') {
  abstract get(id: string): Promise<UserSchema | null>;
  abstract save(user: UserEntity): Promise<void>;
}

export class InMemoryUsers extends Adapter(UserRepository) {
  #rows = new Map<string, ReturnType<UserEntity['toProps']>>();

  // repo queries should return a schema, not an entity
  async get(id: string): Promise<UserEntity | null> {
    const props = this.#rows.get(id);
    return props === undefined ? null : UserEntity.restore(props);
  }

  // repo commands should accept an entity, not a schema, to ensure the entity is valid
  async save(user: UserEntity): Promise<void> {
    this.#rows.set(user.props.id, user.toProps());
    user.commit();
  }
}

export class DomainEvents extends EventCatalog('domain', {
  userCreated: UserCreatedEvent,
}) {}

export class CreateUser extends UseCase('user.create') {
  constructor(private readonly users: UserRepository) {
    super();
  }

  async execute(input: {
    id: string;
    name: string;
    email: string;
  }): Promise<UserEntity> {
    const existing = await this.users.get(input.id);
    if (existing) throw DomainError.UserExists({ id: input.id });
    const user = UserEntity.create(input);
    await this.users.save(user);
    return user;
  }
}

/** Application wiring. Hexok does not own this. */
export function createApp(users: UserRepository = new InMemoryUsers()) {
  return {
    users,
    createUser: new CreateUser(users),
    events: DomainEvents,
  };
}
