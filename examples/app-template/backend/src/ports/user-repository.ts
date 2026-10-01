import { Port } from 'hexok';
import type { UserEntity } from '../entities/user.js';

export abstract class UserRepository extends Port('UserRepository') {
  abstract findAll(): Promise<UserEntity[]>;
  abstract get(id: string): Promise<UserEntity | null>;
  abstract save(user: UserEntity): Promise<void>;
}
