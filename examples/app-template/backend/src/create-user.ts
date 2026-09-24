import {
  Adapter,
  EventCatalog,
  type InferSchema,
  Mapper,
  Port,
  UseCase,
} from 'hexok';
import { z } from 'zod';
import { DomainError } from './errors.js';
import { UserCreatedEvent, UserEntity } from './user.js';

const userRecordSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string(),
});

type UserRecordData = InferSchema<typeof userRecordSchema>;

/** In-memory row. The entity property `id` is stored as `_id`. */
export class UserRecord extends Mapper(
  'memory.User',
  UserEntity,
  userRecordSchema,
) {
  protected fromSource(user: UserEntity): UserRecordData {
    const props = user.toProps();
    return { _id: props.id, name: props.name, email: props.email };
  }

  protected toSource(record: UserRecordData) {
    return { id: record._id, name: record.name, email: record.email };
  }
}

export abstract class UserRepository extends Port('UserRepository') {
  abstract get(id: string): Promise<UserEntity | null>;
  abstract save(user: UserEntity): Promise<void>;
}

export class InMemoryUsers extends Adapter(UserRepository) {
  readonly #model = new UserRecord();
  #rows = new Map<string, UserRecordData>();

  async get(id: string): Promise<UserEntity | null> {
    const record = this.#rows.get(id);
    return record === undefined ? null : this.#model.fromModel(record);
  }

  async save(user: UserEntity): Promise<void> {
    const record = this.#model.toModel(user);
    this.#rows.set(record._id, record);
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
