import { DomainError } from '../../errors/domain.js';
import type { ActorApiUseCaseCtx } from '../context.js';
import type { ActorSpec } from '../factory.js';

/**
 * Guard for use cases that require an actor. The actor's type must be one of
 * the `allowedActors` statics on that use case.
 */
export function allowedActorGuard({
  ctx,
  spec,
}: {
  ctx: ActorApiUseCaseCtx;
  spec: ActorSpec;
}): void {
  if (!spec.allowedActors.includes(ctx.actor.type)) {
    throw DomainError.Unauthorized(
      `Actor type ${ctx.actor.type} is not allowed to execute this use-case`,
    );
  }
}
