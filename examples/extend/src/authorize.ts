import type { UseCaseClass } from '@plinth/app';
import { CodedError } from '@plinth/core';
import type { Handler, Interceptor } from '@plinth/runtime';

/**
 * Reads `static policy`. Missing policy → skip.
 * Prefer `errors.FORBIDDEN()` when the use case declared it.
 */
export class AuthorizeInterceptor implements Interceptor {
  readonly name = 'authorize';

  aroundUseCase(uc: UseCaseClass, next: Handler): Handler {
    return async (ctx) => {
      const policy = (uc as { policy?: string }).policy;
      if (policy === undefined) return next(ctx);
      const executeCtx = ctx as {
        ctx: { principal?: { roles: string[] } };
        errors: { FORBIDDEN?: () => never };
      };
      const roles = executeCtx.ctx.principal?.roles ?? [];
      if (roles.includes(policy) || roles.includes('admin')) {
        return next(ctx);
      }
      if (executeCtx.errors.FORBIDDEN) executeCtx.errors.FORBIDDEN();
      throw new CodedError({ code: 'FORBIDDEN', status: 403 });
    };
  }
}
