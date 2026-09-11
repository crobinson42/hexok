import { Port } from 'kerf/domain';
import type { User } from '../../../domain/entities/index.js';

export interface UserRepository {
  get(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}
export const UserRepository = Port.token<UserRepository>('UserRepository');
