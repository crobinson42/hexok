import type { UseCaseClass } from 'plinth/app';
import type { Envelope, PortToken, UnitOfWork } from 'plinth/domain';
import {
  type Handler,
  type Interceptor,
  requireCapability,
} from 'plinth/runtime';

/**
 * Opens `{ onCommit, onRollback }`, `bindTo(uow)` on transactional ports,
 * commit after `next()`, rollback on throw.
 *
 * Publish flushes **after** the use-case onion, so a successful commit
 * naturally yields after-commit publish.
 *
 * Register **authorize before** unit of work so a forbidden call never
 * opens a transaction.
 */
export class UnitOfWorkInterceptor implements Interceptor {
  readonly key = 'unit-of-work';

  aroundAdapter(port: PortToken<unknown>, impl: unknown): unknown {
    if (hasBindTo(impl)) {
      requireCapability(port, impl, 'bindTo', 'Transactional');
    }
    return impl;
  }

  aroundUseCase(_uc: UseCaseClass, next: Handler): Handler {
    return async (ctx) => {
      const uow = new MemoryUnitOfWork();
      const ports: Record<string, unknown> = {};
      for (const [alias, impl] of Object.entries(ctx.ports)) {
        ports[alias] = hasBindTo(impl) ? impl.bindTo(uow) : impl;
      }
      try {
        const result = await next({ ...ctx, ports });
        await uow.commit();
        return result;
      } catch (error) {
        await uow.rollback();
        throw error;
      }
    };
  }

  async aroundPublish(
    envelope: Envelope,
    next: () => Promise<void>,
  ): Promise<void> {
    envelope.meta.afterCommit = true;
    await next();
  }
}

class MemoryUnitOfWork implements UnitOfWork {
  #commit: Array<() => void | Promise<void>> = [];
  #rollback: Array<() => void | Promise<void>> = [];

  onCommit(fn: () => void | Promise<void>): void {
    this.#commit.push(fn);
  }
  onRollback(fn: () => void | Promise<void>): void {
    this.#rollback.push(fn);
  }
  async commit(): Promise<void> {
    for (const fn of this.#commit) await fn();
  }
  async rollback(): Promise<void> {
    for (const fn of this.#rollback) await fn();
  }
}

function hasBindTo(
  impl: unknown,
): impl is { bindTo: (uow: UnitOfWork) => unknown } {
  return (
    typeof impl === 'object' &&
    impl !== null &&
    'bindTo' in impl &&
    typeof (impl as { bindTo: unknown }).bindTo === 'function'
  );
}
