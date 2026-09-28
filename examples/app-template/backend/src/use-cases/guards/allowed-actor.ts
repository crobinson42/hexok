import { DomainError } from '../../errors/domain.js';
import type { ActorApiUseCaseCtx } from '../context.js';
import type { ActorSpec } from '../factory.js';

type AllowedActorGuardParameters = {
  readonly ctx: ActorApiUseCaseCtx;
  readonly spec: ActorSpec;
};

/**
 * Guard for use cases that require an actor. The actor's type must be one of
 * the `allowedActors` statics on that use case.
 */
export function allowedActorGuard(call: AllowedActorGuardParameters): void {
  if (!call.spec.allowedActors.includes(call.ctx.actor.type)) {
    throw DomainError.Unauthorized(
      `Actor type ${call.ctx.actor.type} is not allowed to execute this use-case`,
    );
  }
}
