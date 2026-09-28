import { DomainError } from '../../errors/domain.js';
import type { ApiUseCaseCtx } from '../context.js';

/**
 * Guard to ensure that the traceId is present in the context.
 */
export function traceIdGuard(call: { readonly ctx: ApiUseCaseCtx }): void {
  if (call.ctx.traceId.length < 1) {
    throw DomainError.TraceIdMissing();
  }
}
