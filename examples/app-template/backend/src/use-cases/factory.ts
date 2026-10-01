import { UseCase } from 'hexok';
import type { z } from 'zod';
import type { Actor } from '../schemas/actor.js';
import type { ActorApiUseCaseCtx, ApiUseCaseCtx } from './context.js';
import { allowedActorGuard } from './guards/allowed-actor.js';
import { inputValidationGuard } from './guards/input-validation-guard.js';
import { traceIdGuard } from './guards/trace-id.js';

export type ActorSpec = {
  allowedActors: Actor['type'][];
  input: z.ZodType | undefined;
};

/**
 * Use-case factory for API use-cases that do not require an actor to be present in the context.
 */
export const PublicApiUseCase =
  UseCase.context<ApiUseCaseCtx>().guard(traceIdGuard);

/**
 * Use-case factory for API use-cases that require an actor to be present in the context.
 * The actor is validated against the allowed actors specified in the use-case definition.
 */
export const ActorApiUseCase = UseCase.context<ActorApiUseCaseCtx, ActorSpec>()
  .guard(traceIdGuard)
  .guard(allowedActorGuard)
    .guard(inputValidationGuard)
  .hooks({
    // preExecute: inputValidationGuard,
  });
