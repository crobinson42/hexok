import type { ErrorFactories } from 'hexok/app';
import type { Actor } from '../domain/schemas/actor.js';
import type { AppContext } from './context.js';
import type { AuthErrors } from './errors.js';

export function requireUser(
  ctx: AppContext,
  userId: string,
  errors: ErrorFactories<AuthErrors>,
): Extract<Actor, { type: 'user' }> {
  const actor = ctx.actor;
  if (!actor) throw errors.UNAUTHORIZED();
  if (actor.type !== 'user' || actor.userId !== userId) {
    throw errors.FORBIDDEN();
  }
  return actor;
}
