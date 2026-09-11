import { Port } from 'plinth/domain';
import type { UserCredentials } from '../../../domain/entities/index.js';

export interface UserCredentialsRepository {
  get(id: string): Promise<UserCredentials | null>;
  getByUserId(userId: string): Promise<UserCredentials | null>;
  save(credentials: UserCredentials): Promise<void>;
}
export const UserCredentialsRepository = Port.token<UserCredentialsRepository>(
  'UserCredentialsRepository',
);
