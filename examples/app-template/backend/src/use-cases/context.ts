import type {Actor} from "../schemas/actor.js";

/**
 * Base context for all API use-cases that are called from a gateway/controller layer. It contains a traceId that can be used for logging and tracing purposes.
 */
export type ApiUseCaseCtx = {
    traceId: string;
}

/**
 * Context for API use-cases that require an actor to be present. It extends the base context with an actor property.
 */
export type ActorApiUseCaseCtx = ApiUseCaseCtx & {
    actor: Actor;
}