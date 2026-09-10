import type { UseCaseClass } from '@plinth/app';
import type { PortToken } from '@plinth/domain';
import {
  type Handler,
  type Interceptor,
  requireCapability,
} from '@plinth/runtime';

/**
 * Ports that `implements RequestScoped` are `fork()`ed per call.
 * Two `local` calls must not share the forked state.
 */
export class RequestScopeInterceptor implements Interceptor {
  readonly key = 'request-scope';

  aroundAdapter(port: PortToken<unknown>, impl: unknown): unknown {
    if (hasFork(impl)) {
      requireCapability(port, impl, 'fork', 'RequestScoped');
    }
    return impl;
  }

  aroundUseCase(_uc: UseCaseClass, next: Handler): Handler {
    return async (ctx) => {
      const ports: Record<string, unknown> = {};
      for (const [alias, impl] of Object.entries(ctx.ports)) {
        ports[alias] = hasFork(impl) ? impl.fork() : impl;
      }
      return next({ ...ctx, ports });
    };
  }
}

function hasFork(impl: unknown): impl is { fork: () => unknown } {
  return (
    typeof impl === 'object' &&
    impl !== null &&
    'fork' in impl &&
    typeof (impl as { fork: unknown }).fork === 'function'
  );
}
