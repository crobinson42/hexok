import { Port } from 'plinth/domain';

export interface PasswordHasher {
  verify(password: string, passwordHash: string): Promise<boolean>;
}
export const PasswordHasher = Port.token<PasswordHasher>('PasswordHasher');
