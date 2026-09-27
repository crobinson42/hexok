import {UseCase} from "hexok";
import type {ActorApiUseCaseCtx, ApiUseCaseCtx} from "./context.js";
import {traceIdGuard} from "./guards/trace-id.js";
import type {Actor} from "../schemas/actor.js";
import type {z} from "zod";
import {DomainError} from "../errors/domain.js";

/**
 * Use-case factory for API use-cases that do not require an actor to be present in the context.
 */
export const PublicApiUseCase = UseCase.context<ApiUseCaseCtx>({
    guard: traceIdGuard
})

/**
 * Use-case factor for API use-cases that require an actor to be present in the context.
 * The actor is validated against the allowed actors specified in the use-case definition.
 */
export const ActorApiUseCase = UseCase.context<ActorApiUseCaseCtx, {
    allowedActors: Actor['type'][]
    input: z.ZodType | void
}>({
    guard: (ctx, spec) => {
        traceIdGuard(ctx)

        if (!spec.allowedActors.includes(ctx.actor.type)) {
            throw DomainError.Unauthorized(`Actor type ${ctx.actor.type} is not allowed to execute this use-case`)
        }
    }
})
