import { Port } from 'hexok/domain';
import type { Actor } from '../../../domain/schemas/actor.js';

export interface AuthTokenService {
  issue(actor: Actor): Promise<string>;
  verify(token: string): Promise<Actor | null>;
}
export const AuthTokenService =
  Port.token<AuthTokenService>('AuthTokenService');
