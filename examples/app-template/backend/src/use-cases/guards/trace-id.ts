import type {ApiUseCaseCtx} from "../context.js";
import {DomainError} from "../../errors/domain.js";

/**
 * Guard to ensure that the traceId is present in the context.
 * @param context
 */
export function traceIdGuard(context: ApiUseCaseCtx): void {
    if (typeof context.traceId === 'string' && context.traceId.length > 0) {
        throw DomainError.TraceIdMissing();
    }
}