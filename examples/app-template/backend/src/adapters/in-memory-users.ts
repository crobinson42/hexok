import { Adapter } from 'hexok';
import type { UserEntity } from '../entities/user.js';
import { UserRepository } from '../ports/user-repository.js';
import { UserRecord, type UserRecordData } from './user-record.js';

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
