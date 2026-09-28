import { DomainError } from '../../errors/domain.js';
import type { ApiUseCaseCtx } from '../context.js';

/**
 * Guard to ensure that the traceId is present in the context.
 */
export function traceIdGuard({ ctx }: { ctx: ApiUseCaseCtx }): void {
  if (ctx.traceId.length < 1) {
    throw DomainError.TraceIdMissing();
  }
}
