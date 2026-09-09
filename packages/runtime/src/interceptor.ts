import type { UseCaseClass } from '@plinth/app';
import type { Envelope, PortToken } from '@plinth/domain';

export type Handler = (ctx: never) => Promise<unknown>;

/**
 * Extension seam. First registered is **outer**.
 * Register authorize before unit of work so a forbidden call never opens a transaction.
 *
 * ```ts
 * class AuthorizeInterceptor implements Interceptor {
 *   readonly name = 'authorize'
 *   aroundUseCase(uc, next) {
 *     return async (ctx) => {
 *       const policy = (uc as { policy?: string }).policy
 *       if (policy) check(ctx, policy)
 *       return next(ctx)
 *     }
 *   }
 * }
 * ```
 *
 * `aroundPublish`: interceptors that swallow `next()` **drop** the event.
 * Publish flushes after the use-case onion, so a successful unit-of-work
 * commit naturally yields after-commit publish.
 */
export interface Interceptor {
  readonly name: string;
  aroundUseCase?(uc: UseCaseClass, next: Handler): Handler;
  aroundAdapter?(port: PortToken<unknown>, impl: unknown): unknown;
  aroundPublish?(envelope: Envelope, next: () => Promise<void>): Promise<void>;
  aroundDispatch?(
    envelope: Envelope,
    uc: UseCaseClass,
    next: () => Promise<void>,
  ): Promise<void>;
}

export function requireCapability(
  token: PortToken<unknown>,
  impl: unknown,
  method: 'bindTo' | 'fork',
  label: 'Transactional' | 'RequestScoped',
): void {
  if (typeof (impl as { [k: string]: unknown })[method] !== 'function') {
    throw new Error(
      `plinth: ${token.name} is ${label.toLowerCase()} but the adapter does not implement ${label}`,
    );
  }
}
