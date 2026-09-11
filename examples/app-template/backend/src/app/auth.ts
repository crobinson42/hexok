import type { Actor } from '../domain/schemas/actor.js';
import type { AppContext } from './context.js';

type AuthErrors = {
  UNAUTHORIZED: () => never;
  FORBIDDEN: () => never;
};

export function requireUser(
  ctx: AppContext,
  userId: string,
  errors: AuthErrors,
): Extract<Actor, { type: 'user' }> {
  const actor = ctx.actor;
  if (!actor) throw errors.UNAUTHORIZED();
  if (actor.type !== 'user' || actor.userId !== userId) {
    throw errors.FORBIDDEN();
  }
  return actor;
}
